// test/scenario-view.test.js — the Scenario planner's day chart rendered under a
// small DOM shim. Two things it pins, both from 22 Sep 2026:
//
//   1. A cycle's labour is drawn at the minute she really works it, and it is
//      never thinner inside the bar than the same job is on the person row
//      below it. Drawn one pixel wide, the fold landed exactly on the seam
//      between two cycles and read as that seam rather than as her working there.
//
//   2. The button that applies the ladder sits on the climb card's own heading.
//      A day of nine modules makes a nine-rung ladder, and a control she has to
//      scroll past all of it to reach is a control that has gone missing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

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
    // Every real node has one, and the view walks UP through it: the clock balloon is
    // placed against the box it is drawn in and the window that box is looked through,
    // and it reads both off `parentNode`. A shim that kept only this file's own
    // `parent` left that whole placement silently skipped — the balloon's height was
    // never written at all, so nothing here could see where it sat. Wired to `parent`,
    // which is what appendChild and remove already keep up to date.
    get parentNode() { return this.parent || null; },
    // The other half of that walk, and the same lesson: a real node has firstChild and
    // a test that asks whether a repaint rebuilt the screen asks it through this. A shim
    // without one answers `undefined` both before and after the repaint, so the question
    // "did anything redraw?" passes without being able to fail.
    get firstChild() { return this.children[0] || null; },
    appendChild(c) { if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parent = this; } return c; },
    append(...cs) { for (const c of cs) if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parent = this; } },
    // Faithful on purpose: the real `replaceChildren` does NOT skip a null the way
    // `el()` skips a null child — it converts every argument with String(), so a null
    // reaches the screen as the word "null". A shim that quietly dropped one would make
    // that invisible to every test here, which is the same lesson this file already
    // carries about a stand-in more forgiving than the browser it stands in for.
    replaceChildren(...cs) {
      this.children = [];
      for (const c of cs) {
        if (c && c.nodeType) { this.children.push(c); if (c.nodeType === 1) c.parent = this; }
        else this.children.push(globalThis.document.createTextNode(String(c)));
      }
    },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { this._listeners[t] = (this._listeners[t] || []).filter((x) => x !== f); },
    // A listener in a browser is handed an EVENT, not a bag of fields, and the two
    // calls the chart now makes on one — preventDefault, for the right-press pan and
    // for the browser's own menu — are on the event because the browser put them
    // there. A shim without them forces the view to test for a method the browser
    // always has, which is a view written for the stub; supplying them is the faithful
    // half of the same rule that put scrollLeft on this node. defaultPrevented is the
    // real event's own property, so a test can ask whether the menu was stopped.
    dispatchEvent(ev) {
      if (!ev.preventDefault) ev.preventDefault = () => { ev.defaultPrevented = true; };
      if (!ev.stopPropagation) ev.stopPropagation = () => {};
      (this._listeners[ev.type] || []).forEach((f) => f(ev));
      return true;
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === "hidden") this.hidden = true;
      // The style ATTRIBUTE and the style object are one thing, so a view that writes
      // `el(tag, { style: "--hour-w:96px" })` — which is how the whole chart writes its
      // ruler, its grid and the day's own width — is readable through the style object
      // afterwards, exactly as it is in a browser.
      if (k === "style") {
        for (const part of String(v).split(";")) {
          const i = part.indexOf(":");
          if (i > 0) declared[part.slice(0, i).trim()] = part.slice(i + 1).trim();
        }
      }
      // A real DOM reflects its boolean attributes onto the properties a view
      // reads back, so `setAttribute("disabled", true)` makes `node.disabled`
      // true. A shim that kept only the attribute made a switched-off press read
      // as live and a placeholder option read as a pickable answer — the same
      // class of fault as the data-* gap below, on the other side of the same
      // question: a stub must be as unforgiving as the browser it stands in for.
      if (k === "disabled" || k === "selected" || k === "checked") this[k] = true;
      // A real DOM exposes a data-* attribute on `dataset`, and the timeline's tap
      // reads which batch it hit off `hit.dataset.k`. A shim that kept the attribute
      // and not the dataset made every bar tap read as batch 1: a whole class of
      // taps the tests could not see, because the stub was more forgiving than the
      // browser it stands in for.
      const m = /^data-(.+)$/.exec(k);
      if (m) this.dataset[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
    },
    getAttribute(k) { return this.attrs[k]; },
    // One box for every node is not enough for a card that is placed by its own
    // measurements: a test that wants a name cell at one place and a card of another
    // size says so with `_rect`, and everything that has not asked keeps the old
    // constant it always had.
    //
    // A real getBoundingClientRect returns a DOMRect, which carries right and bottom
    // as well, and a box without them is a stub more forgiving than the browser it
    // stands in for: the view places a card beside the name by the name's right edge,
    // and against this shim alone that came out as NaN — a card placed at no position
    // at all, which is precisely the fault a test here exists to catch.
    getBoundingClientRect() {
      const r = this._rect || { left: 0, top: 0, width: 600, height: 400 };
      // A rect is measured from the window, so scrolling a box the node is INSIDE
      // moves the node's box and the node itself does not. A stick that returned
      // `_rect` unscrolled would say a row's foot holds still while the list under it
      // slides — and the one thing this app measures inside a scroller is the shelf of
      // days, whose cap is taken from the fourth row's foot. A measurement taken while
      // the shelf was scrolled would then read correct in a test and wrong on her
      // phone. Every ancestor's own scroll is subtracted, this node's own left alone:
      // a box does not move itself.
      let left = r.left;
      let top = r.top;
      for (let n = this.parent || null; n; n = n.parent || null) {
        left -= Number(n.scrollLeft) || 0;
        top -= Number(n.scrollTop) || 0;
      }
      return { left, top, width: r.width, height: r.height, right: left + r.width, bottom: top + r.height };
    },
    focus() {}, click() {},
    // A real node detaches itself from its parent and this one has to as well:
    // a call card that could only be "removed" by the shim quietly doing nothing
    // would let a dismissed announcement sit on the screen in every test.
    remove() {
      if (!this.parent) return;
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
      this.parent = null;
    },
    querySelector() { return null; },
    // A real node can be asked for the nearest ancestor of a kind, and the view asks
    // exactly that to tell a press on her own card from a press on the sheet behind it.
    // A shim with no `closest` answers `undefined` to a question the browser answers,
    // which is the same class of fault as the missing dataset above: a rule the stand-in
    // cannot see is a rule nothing here can break. Walks from this node upward, matching
    // the two selector shapes this app uses — a bare tag and a class.
    closest(sel) {
      const tests = String(sel || "").split(",").map((s) => s.trim()).filter(Boolean);
      for (let n = this; n; n = n.parent || null) {
        if (n.nodeType !== 1) continue;
        for (const t of tests) {
          if (t.startsWith(".")) {
            if (String(n.className || "").split(/\s+/).filter(Boolean).includes(t.slice(1))) return n;
          } else if (n.tagName === t.toUpperCase()) return n;
        }
      }
      return null;
    },
  };
  // A real classList is not a decoration: it IS the class attribute, and every add,
  // remove and toggle writes straight through to it. The stub that stood here was a set
  // of four no-ops, so a class the view put on a node at RUNTIME — the pan's own "the
  // gesture has taken hold" class, ui.js's "dragging", the cursor's "at-end" — was
  // invisible to every assertion in this file, and a rule nothing can see is a rule
  // nothing can break. Backed by className, with the force argument a real toggle takes.
  // A real element's `style` and its style ATTRIBUTE are one thing seen twice — the
  // board's shim has said so since it was written and this one kept the two adrift, with
  // a plain object beside the attribute and only `el`'s own style string reaching the
  // attribute. That gap let a real fault through on 24 September: the board asked for its
  // coach widths with `track.style["--coach-w"] = "36px"`, which in a browser writes
  // NOTHING — a custom property is only reachable through `setProperty`, and an
  // assignment leaves an expando on the style object with the declarations untouched —
  // so every coach fell through to the stylesheet's 34px fallback and six of them filled
  // a line the plan says four fill. The two views are one here for the same reason they
  // are one there, and a custom property asked for through the wrong door reads back
  // empty rather than reading back a value no browser would have drawn.
  const declared = {};
  const syncStyle = () => { node.attrs.style = Object.keys(declared).map((k) => `${k}:${declared[k]}`).join("; "); };
  const loose = {};
  const isCustom = (k) => typeof k === "string" && k.startsWith("--");
  const methods = {
    getPropertyValue(k) { return k in declared ? declared[k] : ""; },
    setProperty(k, v) { declared[k] = String(v); syncStyle(); },
    removeProperty(k) { delete declared[k]; syncStyle(); },
  };
  node.style = new Proxy(methods, {
    get(t, k) { return k in t ? t[k] : (k in declared ? declared[k] : loose[k]); },
    set(t, k, v) {
      if (isCustom(k)) { loose[k] = String(v); return true; }
      declared[k] = String(v); syncStyle(); return true;
    },
    has(t, k) { return k in t || k in declared || k in loose; },
  });
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
  return node;
}
const layers = { "confirm-layer": createEl("div"), "popup-layer": createEl("div") };
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => layers[id] || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  body: createEl("body"),
};
globalThis.setTimeout = (fn) => { fn(); return 1; };
globalThis.clearTimeout = () => {};
// The screen, for the one piece of the view that places something on it: a person's
// card is pinned to the screen rather than to its row, so where it lands is decided
// against these two numbers. A view that cannot see a screen must not place anything,
// which is why this is a plain object rather than a bare global set to undefined.
globalThis.window = { innerWidth: 1000, innerHeight: 800 };
// The frame the pane scroll-sync coalesces its writes on. A browser hands these out
// and runs the batch before the next paint; the shim keeps a queue a test flushes
// by hand. It is NOT wired to the synchronous setTimeout above on purpose: a writer
// that ran the instant the scroll fired would hide the single thing this code
// exists to do — drop the echo of its own write instead of writing back to the pane
// under her finger, which is how an iOS flick is killed.
const frames = [];
globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
globalThis.cancelAnimationFrame = () => {};
// Run the queued frame, and anything a callback queues in turn — bounded, so a
// callback that reschedules itself cannot hang the suite.
const flushFrames = () => {
  for (let i = 0; i < 20 && frames.length; i += 1) {
    for (const fn of frames.splice(0, frames.length)) fn();
  }
};
// The live clock's tick. The run holds a real interval in a browser and a handle
// here, so a test can drive the day a minute at a time instead of waiting for it.
const ticks = [];
globalThis.setInterval = (fn) => { ticks.push(fn); return ticks.length; };
globalThis.clearInterval = () => {};
// The wall clock the run measures itself against. Frozen, so a call's minute is
// an assertion rather than a race — and moved on by hand to walk the day.
let NOW = new Date("2026-09-22T09:00:00").getTime();
Date.now = () => NOW;
if (typeof crypto === "undefined" || !crypto.randomUUID) {
  globalThis.crypto = { randomUUID: () => "00000000-0000-4000-8000-000000000000" };
}
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { renderScenario, renderBoard } = await import("../admin/js/views/scenario.js");
const { ONE_BAKER_SCENARIO, climbSteps, computeScenario, callWindows } = await import("../admin/js/scenario.js");

// Every element under `root`, depth-first, in document order.
function walk(root, out = []) {
  for (const c of root.children || []) {
    if (c.nodeType !== 1) continue;
    out.push(c);
    walk(c, out);
  }
  return out;
}
// The shim keeps text in child text nodes, so this walks them rather than
// trusting a `textContent` a real browser would maintain.
function textOf(n) {
  let s = n.textContent || "";
  for (const c of n.children || []) {
    if (c.nodeType === 3) s += ` ${c.text}`;
    else if (c.nodeType === 1) s += ` ${textOf(c)}`;
  }
  return s;
}
const hasClass = (n, cls) => new RegExp(`(^|\\s)${cls}(\\s|$)`).test(n.className || "");
// A px value out of the inline style string the view writes.
function px(node, key) {
  const m = new RegExp(`${key}:(-?\\d+(?:\\.\\d+)?)px`).exec(node.attrs.style || "");
  return m ? Number(m[1]) : null;
}

function render(overrides = {}) {
  const scen = {
    ...ONE_BAKER_SCENARIO,
    modules: ONE_BAKER_SCENARIO.modules.map((m) => ({ ...m, cycles: (m.cycles || []).map((c) => ({ ...c })) })),
    ...overrides,
  };
  const state = { settings: { currency: "RM", deliveryDays: [1, 3, 5], scenario: scen, scenarios: [] }, uoms: [], ingredients: [], products: [], orders: [], deliveryDates: [] };
  const root = createEl("div");
  renderScenario(root, state);
  return { root, state };
}

// The bars of the row whose name cell carries `name`.
function rowFor(root, name) {
  const row = walk(root).find((n) => hasClass(n, "tl-row") && textOf(n).includes(name));
  assert.ok(row, `no timeline row named ${name}`);
  const track = walk(row).find((n) => hasClass(n, "tl-track"));
  return walk(track).filter((n) => hasClass(n, "tl-bar"));
}
const bandsOf = (bar) => (bar.children || []).filter((c) => c.nodeType === 1 && hasClass(c, "tl-touch"));
const cyclesOf = (bar) => (bar.children || []).filter((c) => c.nodeType === 1 && hasClass(c, "tl-cycle"));
// The shade class of a cycle segment, as `shade-N`.
const shadeOf = (seg) => (String(seg.className).match(/shade-\d+/) || [""])[0];
// The batch numbers drawn above the bars of the row named `name`.
function tagsFor(root, name) {
  const row = walk(root).find((n) => hasClass(n, "tl-row") && textOf(n).includes(name));
  assert.ok(row, `no timeline row named ${name}`);
  const track = walk(row).find((n) => hasClass(n, "tl-track"));
  return walk(track).filter((n) => hasClass(n, "tl-btag"));
}

test("the fold is drawn at its own minute, at the end of its rest", () => {
  const { root } = render();
  const bar = rowFor(root, "The rests and the stretch and folds")[0];
  const barW = px(bar, "width");
  const bands = bandsOf(bar);
  assert.equal(bands.length, 3, "the first three rests each end in a fold");
  // The batch is 31 + 31 + 31 + 30 minutes and the fold is the last minute of
  // each rest, so the drawn position is 30/123 of the way along the bar — and it
  // must not be drawn at the bar's start, which is where the old screen put it.
  const where = px(bands[0], "left") / barW;
  assert.ok(Math.abs(where - 30 / 123) < 0.01, `fold drawn at ${where} of the batch, expected ${30 / 123}`);
});

test("a one-minute job is never thinner on the bar than on the person row", () => {
  const { root } = render();
  const bar = rowFor(root, "The rests and the stretch and folds")[0];
  const band = bandsOf(bar)[0];
  const bandW = px(band, "width");
  assert.ok(bandW >= 4, `the fold is drawn ${bandW}px wide — too thin to read`);

  // The same minute of her day, on the person row that attends it. The two rows
  // are the same arithmetic drawn twice, so they must agree about its width —
  // and its position must agree to within the pixel each of them rounds to.
  const at = px(bar, "left") + px(band, "left");
  const person = rowFor(root, "Person 1")
    .map((b) => ({ left: px(b, "left"), width: px(b, "width") }))
    .filter((b) => Math.abs(b.left - at) <= 1);
  assert.equal(person.length, 1, `no single person-row stretch starts at the fold (px ${at})`);
  assert.equal(person[0].width, bandW, "the bar and the person row disagree about a one-minute job");
});

test("the oven swap is drawn after the bake, not before it", () => {
  const { root } = render();
  const bar = rowFor(root, "The oven swap and the bake")[0];
  const barW = px(bar, "width");
  const band = bandsOf(bar)[0];
  // The module is a 13-minute bake then a 2-minute swap, so her hands are at the
  // far end of it. Drawn at the start it would read as hands going in before the
  // pans came out.
  const where = px(band, "left") / barW;
  assert.ok(Math.abs(where - 13 / 15) < 0.01, `the swap is drawn at ${where} of the module, expected ${13 / 15}`);
});

test("the climb card carries its apply button on the heading when there is a ladder", () => {
  const { root } = render({ target: 48 });
  const heading = walk(root).find((n) => hasClass(n, "section") && textOf(n).includes("The climb"));
  assert.ok(heading, "no climb card");
  const row = heading.parent;
  const btn = walk(row).find((n) => n.tagName === "BUTTON" && /Use these numbers/.test(textOf(n)));
  assert.ok(btn, "the heading does not carry the apply button");
  // And the foot of the card still does, so both ends of a long ladder offer it.
  const all = walk(root).filter((n) => n.tagName === "BUTTON" && /Use these numbers/.test(textOf(n)));
  assert.equal(all.length, 2);
});

test("a scenario that already makes the number she wants offers no button to press", () => {
  const { root } = render({ target: 24 });
  const all = walk(root).filter((n) => n.tagName === "BUTTON" && /Use these numbers/.test(textOf(n)));
  assert.equal(all.length, 0, "there is nothing to apply, so there must be nothing to press");
  assert.match(textOf(root), /already makes your 24 pans/);
});

// ── The way down (v149) ─────────────────────────────────────────────────────
// Her report, 22 Sep 2026, on a One baker day the ladder had raised to 36 and
// then asked for 24: "this does not agrees?" The card said the day already made
// her 24 pans while the line directly above it said the day made 36, and there
// was nothing anywhere on the card to press. Both halves of that are pinned here.

// Her own day, raised the way the ladder raises it, so these tests start from the
// day she was actually looking at rather than from a scenario written in here.
function raisedTo(want) {
  const climb = climbSteps(ONE_BAKER_SCENARIO, want);
  const out = { ...ONE_BAKER_SCENARIO, modules: ONE_BAKER_SCENARIO.modules.map((m) => ({ ...m })) };
  for (const s of climb.steps) {
    out.modules = out.modules.map((m) => (m.id === s.id ? { ...m, ...(s.patch || { repeats: s.to }) } : m));
  }
  return out;
}

test("a day above the number she asked for is headed The way down and offers the button", () => {
  const raised = raisedTo(36);
  const { root } = render({ modules: raised.modules, target: 24 });
  const heading = walk(root).find((n) => hasClass(n, "section") && textOf(n).includes("The way down"));
  assert.ok(heading, "the card is not headed the way down");
  assert.match(textOf(root), /This scenario makes 36 pans, and you want 24\./);
  // The heading carries it, and the foot of the card still does: the day of nine
  // modules that made the climb's ladder long makes this card long too.
  const btn = walk(heading.parent).find((n) => n.tagName === "BUTTON" && /Use these numbers/.test(textOf(n)));
  assert.ok(btn, "the heading does not carry the apply button");
  const all = walk(root).filter((n) => n.tagName === "BUTTON" && /Use these numbers/.test(textOf(n)));
  assert.equal(all.length, 2);
});

test("the card cannot say it already makes her number while it says the day makes more", () => {
  // The exact contradiction she reported, as an assertion: the two sentences can
  // never appear together, because the branch that reads "already makes" is only
  // reached when the two numbers really do agree.
  const raised = raisedTo(36);
  const { root } = render({ modules: raised.modules, target: 24 });
  assert.doesNotMatch(textOf(root), /already makes your 24 pans/, "the card still says the two numbers agree");
  // And the honest reading of the gap is there instead.
  assert.match(textOf(root), /12 pans more than you asked for/);
});

test("pressing Use these numbers brings the day down and leaves her batch times alone", () => {
  const raised = raisedTo(36);
  // She has dragged the mixing's third batch an hour later than its own rhythm.
  // Coming down takes batches off the END of the day, so the times she set by hand
  // have to survive the move — the one place this half deliberately differs from
  // the climb, which re-spaces a module's times because a new count is a new rhythm.
  raised.modules = raised.modules.map((m) => (m.id === "solo_mix" ? { ...m, starts: [1, 88, 235, 262, 349, 436] } : m));
  const { root, state } = render({ modules: raised.modules, target: 24 });
  const btn = walk(root).find((n) => n.tagName === "BUTTON" && /Use these numbers/.test(textOf(n)));
  assert.ok(btn, "no button to press");
  btn.dispatchEvent({ type: "click" });

  const mods = state.settings.scenario.modules;
  assert.ok(mods.every((m) => m.repeats === 4), "the button did not bring every module holding the day down");
  assert.equal(computeScenario(state.settings.scenario).pansPerDay, 24, "the day did not land on her number");
  // The stored list can still be longer than the batches that are left — the move
  // writes the count and never throws away a time she set by hand. Every reader
  // takes only the first `repeats` of it, so the four that remain are hers and
  // the ones off the end are kept rather than destroyed.
  const mix = mods.find((m) => m.id === "solo_mix");
  assert.deepEqual(mix.starts.slice(0, 4), [1, 88, 235, 262], "her dragged batch time was rewritten by the move");
});

test("a batch bigger than the number she wants says so instead of offering a dead button", () => {
  // Six pans a batch and one batch a day; she asks for three. Running fewer
  // batches cannot get under one batch, so there is no move to offer — and a card
  // with nothing on it has to say why rather than read as broken.
  const thin = { ...ONE_BAKER_SCENARIO, modules: ONE_BAKER_SCENARIO.modules.map((m) => ({ ...m, repeats: 1 })) };
  const { root } = render({ modules: thin.modules, target: 3 });
  assert.equal(walk(root).filter((n) => n.tagName === "BUTTON" && /Use these numbers/.test(textOf(n))).length, 0);
  assert.match(textOf(root), /one batch is 6 pans/);
  // Headed by its subject and not by whether a button is there: a card about the
  // day being too high must not be headed "The climb".
  const heading = walk(root).find((n) => hasClass(n, "section") && /The way down|The climb/.test(textOf(n)));
  assert.match(textOf(heading), /The way down/);
});

// ── The cycles inside a batch (v150) ───────────────────────────────────────
// Her report, 22 Sep 2026: "there is not steps term in this project, i want the
// cycle shown in batch, and the cycle labour shown visually". The drawing was
// already there; what was wrong was the word the screen used for a cycle, and a
// shade ladder that claimed "a batch of four reads as four" while giving a
// four-cycle batch the shades 0, 1, 2, 0 — the first and the last cycle wearing
// the same palest band.

test("a batch of four cycles is drawn in four different shades (v150)", () => {
  const { root } = render();
  // The seeded day's fold is one batch of four cycles: three 30-minute rests
  // each ending in a fold, and a last rest that is a rest and nothing else.
  const bar = rowFor(root, "The rests and the stretch and folds")[0];
  const shades = cyclesOf(bar).map(shadeOf);
  assert.equal(shades.length, 4, `the four cycles of the batch drew ${shades.length} segments`);
  assert.deepEqual(shades, ["shade-0", "shade-1", "shade-2", "shade-3"],
    "a four-cycle batch fell back to a shade it had already used");
});

test("a long batch never falls back to the palest shade (v150)", () => {
  // Five cycles on one batch. The ladder caps rather than wraps, so the fifth
  // wears the darkest band and the batch never ends on the faintest one — the
  // whole point of the ladder is that a cycle reads as a band of its own.
  const five = [{ name: "Rest", min: 25, load: 0, unload: 1 }, { name: "Rest", min: 25, load: 0, unload: 1 },
    { name: "Rest", min: 25, load: 0, unload: 1 }, { name: "Rest", min: 24, load: 0, unload: 1 },
    { name: "Rest", min: 24, load: 0, unload: 0 }];
  const modules = ONE_BAKER_SCENARIO.modules.map((m) => (m.id === "solo_fold" ? { ...m, cycles: five } : m));
  const { root } = render({ modules });
  const shades = cyclesOf(rowFor(root, "The rests and the stretch and folds")[0]).map(shadeOf);
  assert.equal(shades.length, 5, `the five cycles drew ${shades.length} segments`);
  assert.equal(shades[4], "shade-3", "the fifth cycle fell back to the palest shade");
  assert.notEqual(shades[4], shades[0]);
});

test("the cycles box does not call a cycle a step (v150)", () => {
  // The chart's own legend paragraph used to be the rendered half of this test.
  // She asked for that paragraph gone in v157 — 330 pixels of a phone screen
  // between her and the chart — so what is left is the cycles box itself, read off
  // the source: it is the sentence that made her doubt the feature existed, and the
  // one place a cycle is named in her own words.
  const src = read("admin/js/views/scenario.js");
  assert.match(src, /Each cycle is one piece of this module's work/);
  assert.doesNotMatch(src, /one step of this module/, "the screen still teaches 'step' for a cycle");
  assert.doesNotMatch(src, /the separate steps of that batch/);
});

// ── Batch numbers on the day (v151) ────────────────────────────────────────
// Her ask, 22 Sep 2026: "I want the each batch to be labeled, B=?, small word
// above it drown batch at every module, every production line."

test("every bar of every module carries its own batch number (v151)", () => {
  const { root } = render();
  const tags = walk(root).filter((n) => hasClass(n, "tl-btag"));
  assert.ok(tags.length > 0, "no batch numbers on the chart at all");
  // One per drawn batch, numbered from B1, and each one names the batch its bar
  // does — that data-k is what makes the number a handle and not just a label.
  for (const t of tags) {
    assert.match(textOf(t).trim(), /^B\d+( Δt=\+\d+)?$/, `a batch number reads "${textOf(t).trim()}"`);
    assert.ok(t.attrs["data-k"] != null, "a batch number carries no batch to open");
    assert.ok(px(t, "left") != null, "a batch number is not placed over its bar");
  }
  // The fold runs four batches in the day, so its row wears four.
  assert.equal(tagsFor(root, "The rests and the stretch and folds").length, 4);
});

test("a module she has two of wears a number on every one of its lines (v151)", () => {
  // Two ovens. The module is drawn as two lines, one under the other, and every
  // bar on both of them is a batch she has to be able to tell apart.
  const modules = ONE_BAKER_SCENARIO.modules.map((m) => (m.id === "solo_oven" ? { ...m, count: 2, overlap: false } : m));
  const { root } = render({ modules });
  const block = walk(root).find((n) => hasClass(n, "tl-block") && textOf(n).includes("The oven swap and the bake"));
  assert.ok(block, "a module she has two of is not drawn as two lines");
  const tags = walk(block).filter((n) => hasClass(n, "tl-btag"));
  // Four batches down two lines: two lots each, and every one of the four bars
  // numbered. A batch number on only the first line would leave half the day
  // unlabelled — which is exactly the module she asked to have labelled.
  assert.equal(tags.length, 4, `two lines of four batches drew ${tags.length} numbers`);
  // The batches are the MODULE's, not the line's: the odd lots take line one and
  // the even lots line two, so both lines together are B1 to B4 and neither line
  // repeats a number.
  const shown = tags.map((t) => textOf(t).trim()).sort();
  assert.deepEqual(shown, ["B1", "B2", "B3", "B4"]);
});

test("a duplicated module is a copy of it, not a new module (v151)", () => {
  const { root, state } = render();
  const before = state.settings.scenario.modules.length;
  const fold = state.settings.scenario.modules.find((m) => m.id === "solo_fold");

  // Open the fold's own editor the way she does — by tapping its row.
  const row = walk(root).find((n) => hasClass(n, "tl-row") && textOf(n).includes("The rests and the stretch and folds"));
  row.dispatchEvent({ type: "click" });
  const btn = walk(layers["popup-layer"]).find((n) => n.tagName === "BUTTON" && /Duplicate this module/.test(textOf(n)));
  assert.ok(btn, "the module editor offers no way to duplicate it");
  btn.dispatchEvent({ type: "click" });

  const mods = state.settings.scenario.modules;
  assert.equal(mods.length, before + 1, "duplicate did not add exactly one module");
  const at = mods.findIndex((m) => m.id === "solo_fold");
  const copy = mods[at + 1];
  assert.ok(copy && copy.id !== "solo_fold", "the copy is not a module of its own");
  assert.equal(copy.name, `${fold.name} (copy)`);
  // The copy carries the source's work verbatim. A new module's defaults are
  // exactly what must NOT reach it — retyping four cycles is the chore this
  // button exists to remove, and a copy that arrived as a fresh 20-minute module
  // would be that chore with extra steps.
  assert.deepEqual(copy.cycles, fold.cycles, "the copy did not carry the source's cycles");
  assert.equal(copy.everyMin, fold.everyMin);
  assert.equal(copy.repeats, fold.repeats);
  assert.equal(copy.batch, fold.batch);
  assert.equal(copy.person, fold.person);
});

// ── Her people (v151) ─────────────────────────────────────────────────────
// Her ask: "we should be allow to change person1 to a name, person2 to a name"
// — and her report on why she could not: "in the person card, now person card is
// not accessible". The row had no handler of any kind.

test("the person row opens their card, and a name typed there is the name on the chart (v151)", () => {
  const { root, state } = render();
  const row = walk(root).find((n) => hasClass(n, "tl-row") && hasClass(n, "tappable") && textOf(n).includes("Person 1"));
  assert.ok(row, "the person row is not a tappable row");
  row.dispatchEvent({ type: "click" });

  const field = walk(layers["popup-layer"]).find((n) => n.tagName === "INPUT" && n.attrs.type === "text");
  assert.ok(field, "the person card has no name field");
  field.value = "Ah Hock";
  field.dispatchEvent({ type: "input" });

  // Kept in the app's settings, not in the scenario: person numbers restart at 1
  // in every scenario, so a name has to belong to the person and not to the line.
  assert.equal(state.settings.personNames[1], "Ah Hock");
  assert.match(textOf(root), /Ah Hock/, "the chart still calls them Person 1");
  assert.doesNotMatch(textOf(root), /👤 Person 1/);

  // The card she is typing in follows too. It is not rebuilt — that is what keeps
  // the cursor in the box — so its own two mentions of the person are rewritten by
  // hand, and a card that went on saying "Call Person 1" over a row that said
  // "Ah Hock" is the card telling her the name did not take.
  const layer = textOf(layers["popup-layer"]);
  assert.match(layer, /👤 Ah Hock/, "the card's own title still says Person 1");
  assert.match(layer, /Call Ah Hock a minute before their next job/);
  assert.doesNotMatch(layer, /Call Person 1/);
});

// ── The live clock (v151) ─────────────────────────────────────────────────
// Her answer when asked how the announcement should be triggered: "A live
// clock". One minute before each job a person owns, in their own colour, with
// their name and a sound — and an unacknowledged call is replaced by the next.

function startTheDay(root) {
  NOW = new Date("2026-09-22T09:00:00").getTime();
  ticks.length = 0;
  const btn = walk(root).find((n) => n.tagName === "BUTTON" && /Start the day now/.test(textOf(n)));
  assert.ok(btn, "no way to start the day");
  btn.dispatchEvent({ type: "click" });
  assert.equal(ticks.length, 1, "the day is not walking");
  return () => ticks[ticks.length - 1]();
}
const minutesLater = (base, min) => { NOW = base + min * 60000; };
const callsOnChart = (root) => walk(root).filter((n) => hasClass(n, "tl-call"));

test("the call comes a minute before the job, and names the person and the job (v151)", () => {
  const { root, state } = render();
  const tick = startTheDay(root);
  const calls = callWindows(state.settings.scenario);
  // The second call of the day, so the first one's own minute is behind us and
  // the assertion is about where the call lands rather than about starting the
  // day at all.
  const second = calls.filter((c) => c.at > 0)[0];
  assert.ok(second, "the seeded day has no second call to test with");

  const base = NOW;
  minutesLater(base, second.at - 1); tick();
  minutesLater(base, second.at); tick();

  const shown = callsOnChart(root);
  assert.equal(shown.length, 1, "the day drew no call, or drew more than one");
  assert.match(textOf(shown[0]), new RegExp(second.name.slice(0, 12)));
  // One minute early and not at the minute: a call is a call to go and stand
  // somewhere, and her fold is a one-minute job.
  assert.match(textOf(shown[0]), /— 0\d:\d\d from now/);
  assert.ok(hasClass(shown[0], "tl-call"));
});

test("a person whose calls are switched off is not called (v151)", () => {
  const { root, state } = render();
  const calls = callWindows(state.settings.scenario);
  const second = calls.filter((c) => c.at > 0)[0];
  state.settings.personCalls = { [second.who]: false };

  const tick = startTheDay(root);
  const base = NOW;
  minutesLater(base, second.at - 1); tick();
  minutesLater(base, second.at); tick();

  // Nobody was called for that job. (Another person's call in the same minute
  // would still be theirs to make, so this asks about the one person, not about
  // the screen being empty.)
  const wrong = callsOnChart(root).filter((n) => new RegExp(second.name.slice(0, 12)).test(textOf(n)));
  assert.equal(wrong.length, 0, "a person she switched off was called anyway");
});

test("an unacknowledged call is replaced by the next, and OK dismisses one (v151)", () => {
  const { root, state } = render();
  const tick = startTheDay(root);
  const calls = callWindows(state.settings.scenario);
  const base = NOW;

  // Walk to the next two calls without ever pressing OK.
  const first = calls[0];
  minutesLater(base, first.at); tick();
  const one = callsOnChart(root);
  assert.equal(one.length, 1, "the first call never arrived");

  // OK takes it away.
  const ok = walk(one[0]).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "OK");
  assert.ok(ok, "the call carries no OK");
  ok.dispatchEvent({ type: "click" });
  assert.equal(callsOnChart(root).length, 0, "OK did not take the call away");

  // And the next one is not queued behind it: it is simply the next call.
  const last = calls[calls.length - 1];
  minutesLater(base, last.at); tick();
  const again = callsOnChart(root);
  assert.equal(again.length, 1, "the next call did not arrive after the first was dismissed");
  assert.match(textOf(again[0]), new RegExp(last.name.slice(0, 12)));
});

test("the call carries the cycle's name when she has given it one, and nothing when she has not (v151)", () => {
  // One module, one batch, starting a minute into the day — so the call at minute
  // 0 is unambiguously the one the assertions are about.
  const one = (name) => ({
    id: "solo", icon: "🥣", name: "Mixing the dough in the tub", job: "mix", on: true, person: 0,
    cycles: [{ name, min: 20, load: 20, unload: 0 }],
    batch: 6, everyMin: 0, repeats: 1, startMin: 1, people: 1,
  });
  const callFor = (name) => {
    const { root } = render({ modules: [one(name)] });
    const tick = startTheDay(root);
    minutesLater(NOW, 0); tick();
    const shown = callsOnChart(root);
    assert.equal(shown.length, 1, `no call arrived for a ${name ? "named" : "unnamed"} cycle`);
    return shown[0];
  };

  // Unnamed: no line at all. This is the assertion that catches the imported
  // trim() — it is production.js's NUMBER formatter, so trim("") answers "0" and
  // the card went out printing a bare 0 above the clock.
  const bare = callFor("");
  assert.equal(walk(bare).filter((n) => hasClass(n, "tl-call-cyc")).length, 0,
    "an unnamed cycle drew a line of its own");

  // Named: the line is there and it is her own words. "The rests and the stretch
  // and folds" is not a thing anybody can go and do, which is why the cycle's own
  // name is worth saying at all.
  const named = callFor("The fold");
  const line = walk(named).find((n) => hasClass(n, "tl-call-cyc"));
  assert.ok(line, "a cycle she named is not on the call");
  assert.match(textOf(line), /The fold/);
});

test("Stop takes the clock and any call away with it (v151)", () => {
  const { root, state } = render();
  const tick = startTheDay(root);
  const calls = callWindows(state.settings.scenario);
  minutesLater(NOW, calls[0].at); tick();
  assert.equal(callsOnChart(root).length, 1);

  const stop = walk(root).find((n) => n.tagName === "BUTTON" && /Stop/.test(textOf(n)));
  assert.ok(stop, "no way to stop the day once it is walking");
  stop.dispatchEvent({ type: "click" });
  assert.equal(callsOnChart(root).length, 0, "a call survived Stop");
  // The now-line is gone too — it is hidden rather than removed, so the class is
  // what to ask about. Since v167 there is one per window, and both have to go: a
  // run that stopped in the modules and went on walking down among the people is
  // the one thing a chart of "now" may never show.
  const nowLines = walk(root).filter((n) => hasClass(n, "tl-now"));
  assert.equal(nowLines.length, 2, `${nowLines.length} now-lines are drawn, not one per window`);
  assert.ok(nowLines.every((n) => n.hidden), "a now-line is still drawn after Stop");
  // And the walk is over, so a later tick cannot call anybody.
  minutesLater(NOW, calls[calls.length - 1].at); tick();
  assert.equal(callsOnChart(root).length, 0, "a stopped day went on calling");
});

// ── The day's own card: working it backwards (v152) ───────────────────────
// Her ask: "how to make the calculate backward works?" The control lives on
// batch 1 of the last module in the build — the card she already gets by tapping
// that bar — and it is a press, not a switch. These three tests pin the card, the
// press and the way back.

// The track of the row named `name`, so a tap can be aimed at one bar of it.
function trackFor(root, name) {
  const row = walk(root).find((n) => hasClass(n, "tl-row") && textOf(n).includes(name));
  assert.ok(row, `no timeline row named ${name}`);
  const track = walk(row).find((n) => hasClass(n, "tl-track"));
  assert.ok(track, `no track in the row named ${name}`);
  return track;
}

// Tapping a bar is a click on the track whose target is the bar: the view reads
// the batch number off `closest(".tl-bar, .tl-btag")`, which the shim has no
// bubbling to deliver for it.
function tapBar(root, name, k) {
  const bar = rowFor(root, name)[k];
  assert.ok(bar, `${name} has no batch ${k + 1} drawn`);
  trackFor(root, name).dispatchEvent({
    type: "click", target: { closest: () => bar }, stopPropagation() {},
  });
  return bar;
}

const popupTitle = () => textOf(walk(layers["popup-layer"]).find((n) => hasClass(n, "popup-title")) || createEl("div"));
const popupBody = () => textOf(layers["popup-layer"]);
const popupButton = (re) => walk(layers["popup-layer"]).find((n) => n.tagName === "BUTTON" && re.test(textOf(n)));
const starts = (state, id) => computeScenario(state.settings.scenario).modules.find((m) => m.id === id).starts;

// One ± pair on the card, found by the label that names what it moves, and not by the
// buttons' own words. Since v180 the day's own card carries two pairs — this batch's,
// and the whole day's — and both wear "+ 5 min" / "− 5 min". A helper that took the
// first match would press whichever pair happened to be built first and call it the
// one it meant, which is the mismatch this helper exists to make impossible.
function popupPair(re) {
  const field = walk(layers["popup-layer"]).find((n) => hasClass(n, "field")
    && walk(n).some((x) => x.tagName === "LABEL" && re.test(textOf(x))));
  assert.ok(field, `the card has no group labelled ${re}`);
  const by = (way) => {
    const b = walk(field).find((n) => n.tagName === "BUTTON"
      && new RegExp(way).test(String(n.getAttribute("aria-label") || "")));
    assert.ok(b, `the group labelled ${re} has no button that goes ${way}`);
    return b;
  };
  return { later: by("later"), earlier: by("earlier") };
}

// The day-backwards group of the controls row. Until v157 it was found by its own
// label; the label is gone — it re-stated the button's own name and wrapped to two
// lines on her phone — so the group is found as the one holding the button, inside
// the controls row and not on the day's own card, which carries buttons with the
// same words on them.
function dayBackGroup(root) {
  const holds = (n) => walk(n).some((x) => x.tagName === "BUTTON" && /Work the day backwards/.test(textOf(x)));
  const row = walk(root).find((n) => hasClass(n, "tl-ctl") && holds(n));
  assert.ok(row, "the controls row has no day-backwards button");
  const el = walk(row).find((n) => hasClass(n, "tl-ctl-group") && holds(n));
  assert.ok(el, "the day-backwards button is not the button of a group in the row");
  return { el, button: (re) => walk(el).find((n) => n.tagName === "BUTTON" && re.test(textOf(n))) };
}

// One group of the controls row, found by the label it carries. The row is a
// series of these, and a view that grows one and drops another is best read as
// the groups it is made of rather than by counting children.
function ctlGroup(root, label) {
  const group = walk(root).find((n) => hasClass(n, "tl-ctl-group")
    && walk(n).some((x) => hasClass(x, "tl-ctl-lab") && new RegExp(`^\\s*${label}\\s*$`).test(textOf(x))));
  assert.ok(group, `the controls row has no group named ${label}`);
  return group;
}

// The last thing the app has said, which is the press she just made.
function lastToast() {
  const said = walk(document.body).filter((n) => hasClass(n, "toast"));
  assert.ok(said.length, "the press said nothing at all");
  return textOf(said[said.length - 1]);
}

test("the backward card opens on batch 1 at the last module, and nowhere else (v152)", () => {
  const { root, state } = render();

  // The last module in the build: Cutting and packing, whose first batch ends at
  // 9:09 am. That is the moment the whole day is hung from.
  tapBar(root, "Cutting and packing", 0);
  assert.match(popupTitle(), /the end of your first batch/, "batch 1 of the last module did not open the day's own card");
  assert.match(popupBody(), /9:09 am/, "the card does not name the moment the day hangs from");
  assert.match(popupBody(), /latest/, "the card does not say what each module's latest start is");
  assert.ok(popupBody().includes("Pull them back to their latest start"), "a day with slack offers no way to take it out");

  // The first module is not it: its batch 1 IS the module's own start time and the
  // first thing in the day, so it keeps the card it has always had.
  tapBar(root, "Mixing the dough in the tub", 0);
  assert.doesNotMatch(popupTitle(), /the end of your first batch/, "the first module opened the day's own card");
  assert.match(popupTitle(), /batch 1 of 4/, "the first module's own card is gone");

  // And a line of a single module is not a chain at all, so nothing hangs from its
  // last thing either — it keeps its ordinary card.
  const one = render({ modules: [ONE_BAKER_SCENARIO.modules.find((m) => m.id === "solo_pack")] });
  tapBar(one.root, "Cutting and packing", 0);
  assert.doesNotMatch(popupTitle(), /the end of your first batch/, "a one-module day opened the day's own card");
  // The signpost to the card names the bar to tap, but only where there is one.
  assert.match(textOf(one.root), /batch 1 of 4|Cutting and packing/);
  void state;
});

test("one press works the day backwards and leaves the day's own numbers alone (v152)", () => {
  const { root, state } = render();
  const before = computeScenario(state.settings.scenario);
  assert.equal(before.pansPerDay, 24, "one baker day does not make twenty-four pans before the press");
  assert.equal(before.endMin, 570, "the day did not finish at 1:30 pm before the press");

  tapBar(root, "Cutting and packing", 0);
  const pull = popupButton(/Pull them back to their latest start/);
  assert.ok(pull, "the day card has no pull-back button");
  pull.dispatchEvent({ type: "click" });

  const after = computeScenario(state.settings.scenario);
  // The mix goes in as late as the chain allows — 4:43 am against the 4:01 am it
  // was stored at — and every module above the last one comes with it.
  assert.equal(starts(state, "solo_mix")[0], 43, "the mix was not pulled back to its latest start");
  assert.deepEqual(starts(state, "solo_mix"), [43, 130, 217, 304], "the module's own rhythm did not come with it");
  assert.deepEqual(starts(state, "solo_oven"), [282, 369, 456, 543], "a module in the middle did not come with the chain");
  assert.deepEqual(starts(state, "solo_pack"), [297, 384, 471, 558], "the last module moved when there was nothing to pull it back to");

  // The whole point of a backward pass: the day is now tight, and it still makes
  // the same pans and still finishes in the same minute.
  assert.equal(after.pansPerDay, 24, "the press changed how many pans the day makes");
  assert.equal(after.endMin, 570, "the press moved the end of the day");
  for (const m of after.on) {
    const flat = m.passes.every((p, i, all) => i === 0 || Math.round(p.at - all[i - 1].at) === Math.round(m.everyMin));
    assert.ok(flat, `${m.name}: the press changed the spacing between its batches`);
  }

  // And the press writes START TIMES and nothing else. It used to spell out a batch
  // list for every module it touched, and a list is read as the whole truth about
  // where every batch sits — so a single press of this one button left the "Minutes
  // from one batch to the next" box of the entire day answering nothing. Her report,
  // 23 September 2026: "cannot reflect even i reduce it to 13, look like something
  // prevent it from loweriing below 25."
  for (const m of state.settings.scenario.modules) {
    assert.equal(m.starts, undefined,
      `${m.name} came out of the press carrying a list of times, so its pace box is dead`);
  }

  // And the press cannot walk the day into an impossible order: no module may end
  // a lot after the module below it has started the same lot. The day was in order
  // before, so this asks whether the press kept it — which is the whole reason the
  // pass measures the room between neighbours instead of subtracting a sum.
  const outOfOrder = (r) => {
    let n = 0;
    for (let i = 0; i < r.on.length - 1; i += 1) {
      const above = r.on[i];
      const below = r.on[i + 1];
      for (let k = 0; k < above.passes.length; k += 1) {
        if (above.passes[k].end > below.passes[k].at + 0.001) n += 1;
      }
    }
    return n;
  };
  assert.equal(outOfOrder(before), 0, "the seeded day is not in order, so this test covers nothing");
  assert.equal(outOfOrder(after), 0, "the press started a lot before the dough it is made of exists");

  // A day with nothing left to take out says so rather than offering a button that
  // would change nothing, and the way back appears with it.
  assert.doesNotMatch(popupBody(), /Pull them back to their latest start/, "a tight day still offers the pull-back button");
  assert.match(popupBody(), /already as late as it can go/, "a tight day does not say so");
  assert.ok(popupButton(/Put my start times back/), "there is no way back from the press");
});

test("the way back puts every start time exactly where it was, and then goes (v152)", () => {
  const { root, state } = render();
  const was = { solo_mix: starts(state, "solo_mix"), solo_fold: starts(state, "solo_fold"), solo_oven: starts(state, "solo_oven") };
  // Stored the way her own modules are: a start time and no list of its own, which
  // is what the press has to survive without turning into a row of zeroes.
  for (const m of state.settings.scenario.modules) {
    assert.equal(m.starts, undefined, `${m.name} is stored with a list of times, so this test is not covering her case`);
  }

  tapBar(root, "Cutting and packing", 0);
  popupButton(/Pull them back to their latest start/).dispatchEvent({ type: "click" });
  assert.equal(starts(state, "solo_mix")[0], 43, "the press did not happen, so there is nothing to undo");

  const back = popupButton(/Put my start times back/);
  assert.ok(back, "the way back is missing");
  back.dispatchEvent({ type: "click" });
  assert.deepEqual(starts(state, "solo_mix"), was.solo_mix, "the mix was not put back");
  assert.deepEqual(starts(state, "solo_fold"), was.solo_fold, "a module above was not put back");
  assert.deepEqual(starts(state, "solo_oven"), was.solo_oven, "a module in the middle was not put back");
  assert.equal(computeScenario(state.settings.scenario).endMin, 570, "the day did not come back as it was");
  // The day she had is stored exactly as it was, list and all: putting a time back
  // must not leave behind a list that turns Auto spacing into an even one.
  for (const m of state.settings.scenario.modules) {
    assert.equal(m.starts, undefined, `${m.name} came back with a list of times it did not have`);
  }
  assert.equal(popupButton(/Put my start times back/), undefined, "the way back is still offered after it was used");
});

// Her report of 23 September 2026, in her own words: "im now on my 36loaf scenario,
// pls check why im lowering the minutes frrom one batch to the next, cannot reflex
// even i reduce it to 13, look like something prevent it from loweriing below 25".
//
// Two things were true at once and this test is both of them. A start list answers for
// every batch, so on a module that carried one the pace box answered NOTHING — not 13,
// not 87, nothing — which is the "cannot reflect". And a module that takes one batch at
// a time cannot run two of them closer together than one batch lasts, which is the
// "prevent it from loweriing below 25": true, and the card used to say nothing about it.
test("the pace box reaches a module that carries a start list, and says when the machine is what holds it (v172)", () => {
  const bake = {
    id: "bake", icon: "🔥", name: "The bake", on: true, person: 0,
    cycles: [{ name: "Bake", min: 25, load: 0, unload: 0 }],
    batch: 6, repeats: 4, startMin: 0, people: 1, count: 1,
    everyMin: 25, everyAuto: false,
    // Stored the way a press used to leave it: a list of its own, five-and-twenty
    // minutes apart — a list the pace box could not argue with.
    starts: [0, 25, 50, 75],
  };
  const { root, state } = render({ modules: [bake] });
  const stored = () => state.settings.scenario.modules[0];

  openModule(root, "The bake");
  const paceField = () => walk(layers["popup-layer"]).find((n) => hasClass(n, "field")
    && walk(n).some((c) => c.tagName === "LABEL" && textOf(c).trim() === "Minutes from one batch to the next"));
  assert.ok(paceField(), "the module card has no box for the minutes from one batch to the next");
  const pace = walk(paceField()).find((n) => n.tagName === "INPUT");
  const hint = () => textOf(walk(paceField()).find((n) => hasClass(n, "hint")) || createEl("div"));
  // At the pace the module already runs, the box explains itself and nothing else:
  // nothing is being held back, so there is nothing to warn about.
  assert.match(hint(), /The pace the batches repeat at/, "the pace box does not explain itself");

  // The number she typed reaches the batches. Without this the list went on answering
  // for all four of them and the box was a control that did nothing at all.
  pace.value = "13";
  pace.dispatchEvent({ type: "input" });
  assert.equal(stored().everyMin, 13, "the pace she typed was not stored");
  assert.deepEqual(stored().starts, [0, 13, 26, 39], "the stored list did not follow the pace she typed");
  assert.equal(stored().startMin, 0, "changing the pace moved where the module begins");
  // The day runs them at 13 no lower than the machine allows, which is the second half
  // of her report: one oven takes one batch at a time, so its own 25 minutes is the
  // tightest two of them can run. That is a fact about her oven, not a rule of the
  // app's — so the card has to say it, and name the two ways to run closer.
  assert.deepEqual(starts(state, "bake"), [0, 25, 50, 75], "the day did not take the pace as far as the machine allows");
  assert.match(hint(), /One batch at a time/, "a pace the machine cannot reach is not explained");
  assert.match(hint(), /cannot start closer together than the 25 minutes/, "the card does not name the minutes holding it");
  assert.match(hint(), /second production line/, "the card names no way to run the batches closer");
  assert.match(hint(), /Allow multiple production line/, "the card names only one of the two ways out");

  // A pace the machine CAN reach is honoured outright, and the warning goes.
  pace.value = "40";
  pace.dispatchEvent({ type: "input" });
  assert.deepEqual(stored().starts, [0, 40, 80, 120], "raising the pace did not reach the batches");
  assert.deepEqual(starts(state, "bake"), [0, 40, 80, 120], "the day did not run at the pace she typed");
  assert.match(hint(), /The pace the batches repeat at/, "the warning stayed on a pace nothing is holding back");

  // And a batch she has held off by hand keeps its hold across a pace change: it moves
  // by the minutes the rhythm moved, rather than being pulled back onto it.
  stored().starts = [0, 40, 80, 130];
  pace.value = "20";
  pace.dispatchEvent({ type: "input" });
  assert.deepEqual(stored().starts, [0, 20, 40, 70], "a batch held off by hand was pulled back onto the rhythm");

  // ── and the same box's own two faults, found after v172 shipped ────────────
  //
  // Her report of the same day, arriving with v172 already on her phone: "1st
  // module, time betwenn each batch, set to 21, but no effect, or the chart dont
  // workout" — and, asked which of the two she saw, "both batch start the same
  // time". Both were the box itself, and both are covered here on HER first module
  // and her own numbers: the mix, 87 minutes a batch as stored, a batch pulled
  // closer by hand, and 21 typed.
  const her = render();
  const mix = () => her.state.settings.scenario.modules.find((m) => m.id === "solo_mix");
  const mixStarts = () => starts(her.state, "solo_mix");
  const paceFieldIn = () => {
    const field = walk(layers["popup-layer"]).find((n) => hasClass(n, "field")
      && walk(n).some((c) => c.tagName === "LABEL" && textOf(c).trim() === "Minutes from one batch to the next"));
    assert.ok(field, "the module card has no box for the minutes from one batch to the next");
    return field;
  };
  const paceIn = () => walk(paceFieldIn()).find((n) => n.tagName === "INPUT");
  const paceSays = () => textOf(walk(paceFieldIn()).find((n) => hasClass(n, "hint")) || createEl("div"));
  const sameMinute = (list) => list.some((v, i) => i > 0 && Math.round(v) === Math.round(list[i - 1]));

  // A batch she has pulled closer by hand than the pace the module is stored with.
  // Re-spaced the old way this landed in front of the batch above it — [0, 21] at a
  // stored pace of 87 came out as [0, −45], which the day reads as minute 0 — and
  // both batches were drawn on the same minute, which is exactly what she saw.
  Object.assign(mix(), { repeats: 2, startMin: 0, everyMin: 87, starts: [0, 21] });
  openModule(her.root, "Mixing the dough in the tub");
  let box = paceIn();
  box.value = "21";
  box.dispatchEvent({ type: "input" });
  assert.deepEqual(mix().starts, [0, 21], "a pace she typed threw away a batch she had pulled closer by hand");
  assert.deepEqual(mixStarts(), [0, 21], "the day does not run the two batches 21 minutes apart");
  assert.ok(!sameMinute(mixStarts()), "both batches are back on the same minute");

  // Taken all the way onto the batch above it, the same press separates them again
  // rather than leaving two batches sharing one minute.
  Object.assign(mix(), { everyMin: 87, everyAuto: false, starts: [0, 0] });
  box = paceIn();
  box.value = "21";
  box.dispatchEvent({ type: "input" });
  assert.deepEqual(mix().starts, [0, 21], "a batch sitting on the one above it was left there");
  assert.ok(!sameMinute(mixStarts()), "two batches still share a minute");

  // A hold that is still a hold is kept, exactly as v172 promised: 120 is 33 minutes
  // past the 87 it was stored at, so it lands 33 minutes past the 21 she types.
  Object.assign(mix(), { everyMin: 87, everyAuto: false, starts: [0, 120] });
  box = paceIn();
  box.value = "21";
  box.dispatchEvent({ type: "input" });
  assert.deepEqual(mix().starts, [0, 54], "a hold that is still a hold was thrown away");

  // Two holds, and the second falls BEHIND the first once the rhythm shortens — 120 is
  // held 33 past the 87, and 130 is on the 87's own line, so at 21 the third batch would
  // land on 42, nine minutes in front of the batch above it at 54. A batch may be held
  // back off the rhythm; it may never be left in front of the batch above it.
  Object.assign(mix(), { repeats: 3, everyMin: 87, everyAuto: false, starts: [0, 120, 130] });
  box = paceIn();
  box.value = "21";
  box.dispatchEvent({ type: "input" });
  assert.deepEqual(mix().starts, [0, 54, 75], "a batch was left in front of the batch above it");
  assert.ok(!sameMinute(mixStarts()), "two of the three batches share a minute");
  mix().repeats = 2;

  // A hold is counted as minutes PAST the module's own line and never as minutes before
  // it: a batch she has pulled closer than its line has no hold left to carry, so it takes
  // the line instead. Stored 90 and 100 against a rhythm of 87, the second batch is 3 past
  // its line and the third 74 BEFORE its own — so at 21 they land on their lines, 24 and
  // 42, rather than on a minute worked out from a shorter-than-the-rhythm number.
  Object.assign(mix(), { repeats: 3, everyMin: 87, everyAuto: false, starts: [0, 90, 100] });
  box = paceIn();
  box.value = "21";
  box.dispatchEvent({ type: "input" });
  assert.deepEqual(mix().starts, [0, 24, 42], "a batch pulled closer than its line carried a hold it does not have");
  mix().repeats = 2;

  // And the box emptied really does mean Auto. It used to keep a list with the old
  // pace baked into it, and a list answers for every batch — so Auto changed nothing
  // and a pace typed afterwards came out nowhere near the number: "no effect".
  Object.assign(mix(), { everyMin: 87, everyAuto: false, starts: [0, 87] });
  const readoutWas = her.root.children[1].firstChild;
  box = paceIn();
  box.value = "";
  box.dispatchEvent({ type: "input" });
  assert.equal(mix().everyAuto, true, "an emptied pace box did not go back to Auto");
  assert.equal(mix().starts, undefined, "Auto left a list of times behind, so the cycles no longer decide");
  // The press has to write the 0 that MEANS Auto and then save and repaint. Written
  // through set() it was refused — this box's minimum is 1, and the refusal returned
  // before either — so the flag moved and nothing else: the box went empty over a chart
  // that had not moved, and a reload forgot the choice. Measured live on her own mix.
  assert.equal(mix().everyMin, 0, "Auto did not write the 0 that means Auto, so the box's old pace stayed on the module");
  assert.notEqual(her.root.children[1].firstChild, readoutWas,
    "the Auto press saved and repainted nothing, so the day went on drawing the spacing it had");
  assert.deepEqual(mixStarts(), [0, 20], "Auto does not follow the module's own cycle length");
  box = paceIn();
  box.value = "21";
  box.dispatchEvent({ type: "input" });
  assert.deepEqual(mixStarts(), [0, 21], "the pace she typed after Auto did not reach the batches");

  // A module that runs ONE batch has no second batch for a pace to sit between, and
  // a box that quietly does nothing is a fault of its own — her words open on it:
  // "time betwenn each batch, set to 21, but no effect". So it says so, and it says
  // it only when the day really does run one: a module following the one above it
  // runs as many as that one does, so the count is the day's and not the stored one.
  mix().repeats = 1;
  mix().starts = undefined;
  mix().everyAuto = false;
  mix().everyMin = 87;
  openModule(her.root, "Mixing the dough in the tub");
  assert.match(paceSays(), /runs one batch in the day/, "a pace box with nothing to space does not say so");
  mix().repeats = 2;
  openModule(her.root, "Mixing the dough in the tub");
  assert.doesNotMatch(paceSays(), /runs one batch in the day/, "a module running two batches is told it has nothing to space");
});

test("the step pairs on the day card move the whole day and keep its shape (v152)", () => {
  const { root, state } = render();
  const before = computeScenario(state.settings.scenario);
  const wasAt = new Map(before.on.map((f) => [f.id, Number(f.startMin)]));
  // The room between neighbouring modules, which is the shape of the day: a move
  // of the whole day leaves every one of these exactly where it was.
  const gaps = (r) => r.on.slice(1).map((f, i) => Number(f.startMin) - Number(r.on[i].startMin));

  tapBar(root, "Cutting and packing", 0);
  // Found by the label that names the scope, because since v180 this card carries a
  // second pair wearing the same two buttons, moving this batch alone.
  const later = popupPair(/the whole day/).later;
  later.dispatchEvent({ type: "click" });

  const after = computeScenario(state.settings.scenario);
  for (const f of after.on) {
    assert.equal(Number(f.startMin) - wasAt.get(f.id), 5, `${f.name} did not move with the whole day`);
  }
  assert.deepEqual(gaps(after), gaps(before), "the whole-day move re-laid the day instead of moving it");
  assert.equal(after.pansPerDay, 24, "moving the whole day changed how many pans it makes");

  // A day moved by hand offers the same way back as a day pulled back, and it is
  // the day she began with rather than the step before the last one.
  popupPair(/the whole day/).earlier.dispatchEvent({ type: "click" });
  const back = popupButton(/Put my start times back/);
  assert.ok(back, "moving the whole day offers no way back");
  back.dispatchEvent({ type: "click" });
  for (const f of computeScenario(state.settings.scenario).on) {
    assert.equal(Number(f.startMin), wasAt.get(f.id), `${f.name} was not put back to where the day began`);
  }
});

// ── The last module's first batch is a batch too (v180) ───────────────────
// Her report at that bar: "the last module batch pop up, still dont mark his delta?"
// It was the one bar on her chart whose card said nothing about the batch it belongs
// to and could take no hold at all — dayEndOf routed the tap past the batch card
// altogether. The day card stands, unchanged, and the batch's own half now stands on
// top of it: the four readings, the pair, and the way back off a hold.

test("the last module's first batch carries the readings and the pair every other bar carries (v180)", () => {
  const { root, state } = render();
  const pack = () => state.settings.scenario.modules.find((m) => m.id === "solo_pack");
  const wasAt = new Map(computeScenario(state.settings.scenario).on.map((f) => [f.id, Number(f.startMin)]));

  tapBar(root, "Cutting and packing", 0);
  assert.match(popupTitle(), /the end of your first batch/, "the day's own card stopped opening on that bar");
  assert.match(popupBody(), /Batch 1/, "the last module's card does not say which batch it is");
  assert.match(popupBody(), /→/, "the last module's card does not read out the batch's two times");
  assert.match(popupBody(), /latest/, "the day's own reading left the card with the batch's half added");
  assert.ok(popupButton(/Pull them back to their latest start/), "the day card lost its own press");

  // The pair at the top of that card is the BATCH's, and it writes the hold every
  // other batch card writes: this batch later, and nothing else moved a minute —
  // not this module's other batches, and nothing above it.
  popupPair(/^\s*Five minutes\s*$/).later.dispatchEvent({ type: "click" });
  assert.deepEqual(pack().startDelta, [5, 0, 0, 0],
    "the press on the last module's first batch moved batches it was not pressed on");
  for (const f of computeScenario(state.settings.scenario).on) {
    if (f.id === "solo_pack") continue;
    assert.equal(Number(f.startMin), wasAt.get(f.id), `${f.name} moved with a hold on the last module`);
  }
  assert.match(popupBody(), /Δt = \+5 min/, "the card does not mark the hold it just took");
  assert.match(lastToast(), /Batch 1 held back 5 minutes/, "the press does not say what it did");

  // And the bar is marked, in the same words and the same tint a held batch anywhere
  // else on the chart carries.
  const tag = tagsFor(root, "Cutting and packing")[0];
  assert.match(textOf(tag), /Δt=\+5/, "the last module's own bar does not carry the hold it is on");
  assert.ok(hasClass(tag, "nudged"), "the last module's bar is not tinted as a held batch is");

  // The way back is the same one, in the same words, and it leaves the day where it
  // began rather than one step back.
  popupButton(/Back onto the line/).dispatchEvent({ type: "click" });
  assert.equal(pack().startDelta[0], 0, "the way back left the hold standing");
  assert.match(lastToast(), /Batch 1 back at/, "the way back does not say where it landed");
});

test("the day's own row works the day backwards on the spot (v153)", () => {
  // v152 put this move behind a tap on one particular bar and left a chip in the
  // row that only said where that bar was. She reported it as what it looks like —
  // "why no button for work backward, this is to reeposition the batches latest
  // start time" — so the row does the work now: one press, no card in the way, and
  // the card keeps the chain and the way back.
  const { root, state } = render();
  const before = computeScenario(state.settings.scenario);
  assert.equal(before.endMin, 570, "one baker day does not finish at 1:30 pm before the press");

  const group = dayBackGroup(root);
  // The moment her day hangs from is named on the card this button's own move
  // opens, not above the button: v157 took the label out of the row, because it
  // re-stated the button's own name and wrapped to two lines on her phone. What is
  // left is the button and, once the day has moved, the way back — and still
  // nothing beside the button that only looks pressable.
  assert.equal(walk(group.el).filter((n) => hasClass(n, "tl-ctl-lab")).length, 0,
    "the day-backwards group has a label above the button again");
  assert.equal(walk(group.el).filter((n) => n.tagName === "BUTTON").length, 1,
    "something beside the button in the day-backwards row looks pressable");

  group.button(/Work the day backwards/).dispatchEvent({ type: "click" });

  // Exactly the card's own press: the mix in as late as the chain allows, the
  // anchor and the day's finish untouched, and the same pans on the shelf.
  assert.equal(starts(state, "solo_mix")[0], 43, "the row press did not put the mix at its latest start");
  assert.deepEqual(starts(state, "solo_mix"), [43, 130, 217, 304], "the module's own rhythm did not come with it");
  assert.deepEqual(starts(state, "solo_oven"), [282, 369, 456, 543], "a module above did not come with the chain");
  assert.deepEqual(starts(state, "solo_pack"), [297, 384, 471, 558], "the module the day hangs from moved");
  const after = computeScenario(state.settings.scenario);
  assert.equal(after.pansPerDay, 24, "the press changed how many pans the day makes");
  assert.equal(after.endMin, 570, "the press moved the end of the day");

  // And it says what it did, which is the card's own sentence rather than a second
  // wording to keep in step.
  const said = lastToast();
  assert.match(said, /worked back to their latest start/, "the row press does not say what moved");
  assert.match(said, /9:09 am/, "the row press does not read the moment back");
});

test("a day already worked back keeps the button, and it says it is done (v153)", () => {
  // The other half of her answer: a button that vanishes once the work is done
  // reads as a fault, which is the shape of the report this release answers.
  const { root, state } = render();
  dayBackGroup(root).button(/Work the day backwards/).dispatchEvent({ type: "click" });
  assert.equal(starts(state, "solo_mix")[0], 43, "the first press did not work the day back");

  const still = dayBackGroup(root).button(/Work the day backwards/);
  assert.ok(still, "the button disappeared once the day had been worked back");
  const was = starts(state, "solo_mix");
  still.dispatchEvent({ type: "click" });
  assert.deepEqual(starts(state, "solo_mix"), was, "a second press moved a day that was already tight");
  assert.match(lastToast(), /already as late as it can go/, "a finished day does not say so");
});

test("the row carries the way back beside the button that moved the day (v153)", () => {
  // Without this the row's press would move her whole day and leave the undo three
  // taps away on one bar — the same hunt the row's button exists to end.
  const { root, state } = render();
  const was = starts(state, "solo_mix");
  assert.equal(dayBackGroup(root).button(/Put my start times back/), undefined,
    "the way back is offered before anything has moved");

  dayBackGroup(root).button(/Work the day backwards/).dispatchEvent({ type: "click" });
  assert.equal(starts(state, "solo_mix")[0], 43, "the press did not happen, so there is nothing to undo");

  const back = dayBackGroup(root).button(/Put my start times back/);
  assert.ok(back, "a press from the row offers no way back in the row");
  back.dispatchEvent({ type: "click" });
  assert.deepEqual(starts(state, "solo_mix"), was, "the row's way back did not put the day where it was");
  assert.equal(dayBackGroup(root).button(/Put my start times back/), undefined,
    "the way back is still offered after it was used");
  // A module whose spacing was Auto before the press must have no stored list
  // afterwards either, or it comes back as an even spacing she never asked for.
  assert.equal(state.settings.scenario.modules.every((m) => m.starts === undefined), true,
    "the way back left behind a list of times the module did not have");
});

test("the way back lives in the screen, not in her saved data (v153)", () => {
  // The snapshot must never reach her data blob. Written there, a reload would
  // resurrect a day she has since left and offer to put her times back to a shape
  // that is no longer hers — and this was found by measuring the blob after a
  // press, not by reading the code, because the two doors passed different things
  // in and only one of them was the screen's own record.
  const { root, state } = render();
  dayBackGroup(root).button(/Work the day backwards/).dispatchEvent({ type: "click" });
  assert.equal(starts(state, "solo_mix")[0], 43, "the press did not happen");
  assert.equal(state.dayBefore, undefined, "the row press wrote its snapshot into her saved state");

  // Both doors are one press: the card she would have opened first carries the way
  // back for a day the ROW moved, because both read the one snapshot.
  tapBar(root, "Cutting and packing", 0);
  assert.ok(popupButton(/Put my start times back/),
    "a press from the row leaves the card with no way back, so the two doors are not the same press");
  assert.equal(state.dayBefore, undefined, "opening the card wrote a snapshot into her saved state");
});

test("a line with no chain says so rather than drawing a dead button (v153)", () => {
  // A line of a single module is not a chain: its first batch is that module's own
  // start time and there is nothing above it to measure a latest start against.
  // The button stays where it is — it never comes and goes — and says which of the
  // two this is instead of inventing a move.
  const one = render({ modules: [ONE_BAKER_SCENARIO.modules.find((m) => m.id === "solo_pack")] });
  const group = dayBackGroup(one.root);
  // Nothing in this group claims a clock at all — since v157 there is no label
  // here to name one, and a one-module line has no moment to name.
  assert.doesNotMatch(textOf(group.el), /\d:\d\d/, "a one-module line named a moment it does not have");

  const wasAt = one.state.settings.scenario.modules[0].startMin;
  group.button(/Work the day backwards/).dispatchEvent({ type: "click" });
  assert.match(lastToast(), /no module above its last one/, "a one-module line said nothing useful");
  assert.equal(one.state.settings.scenario.modules[0].startMin, wasAt, "a one-module line was moved anyway");
  assert.equal(dayBackGroup(one.root).button(/Put my start times back/), undefined,
    "a line that never moved offered a way back");
});

// ── How a module takes its start, and the people she is reading it against (v154)
// Her three reports of 22 September, all inside the Scenario planner:
//
//   1. "the cut and packing batch din follow the earlier batch end", corrected by
//      her to "cutting and packing sit below cooling down, so cutting and packing
//      batch start should follow cooling down batch end".
//   2. "The delta t disappeared, before this we have it. I want each batch start
//      time to be adjustable, like the 1st module. Just need to show delta on the
//      batch 1st offset only, then following module of that step dont have to show
//      the delta because it follow the previous module tightly."
//   3. "I want to freeze the persons card, so that by scrolling thru modules i can
//      see exactly where that slot of that person tie up to and searching for
//      opportunity to move some batch start time to reduce the number of person
//      needed."
//
// Her directive for the first of them: "the behaviour has to base on configuration,
// not a hard wired" — so the answer is three pills on the module's own card.

// The module editor of the row named `name`, opened the way she opens it.
function openModule(root, name) {
  const row = walk(root).find((n) => hasClass(n, "tl-row") && !hasClass(n, "person") && textOf(n).includes(name));
  assert.ok(row, `no module row named ${name}`);
  row.dispatchEvent({ type: "click" });
  return row;
}

test("the module card offers the three answers, and the packing lands on the oven (v154)", () => {
  const { root, state } = render();
  const pack = () => state.settings.scenario.modules.find((m) => m.id === "solo_pack");

  openModule(root, "Cutting and packing");
  assert.match(popupBody(), /How this module takes its start/, "the card does not ask how this module takes its start");
  for (const label of ["As the one above finishes", "Never before the one above finishes", "Its own time"]) {
    assert.ok(popupButton(new RegExp(label)), `the card offers no way to say ${label}`);
  }
  // It opens on the answer the module already behaves with. Her saved packing has a
  // start time of its own and nothing above it has a say, which is what the old
  // switch being off meant — so the pill it opens on is "Its own time".
  assert.ok(hasClass(popupButton(/Its own time/), "cal-mode-on"), "the card does not show which answer this module is on");

  const before = px(rowFor(root, "Cutting and packing")[0], "left");
  popupButton(/As the one above finishes/).dispatchEvent({ type: "click" });

  // Both keys are written: the new one for the three-way choice, and the old switch
  // a save made by an older phone is still read through.
  assert.equal(pack().startMode, "after", "the answer she picked was not stored");
  assert.equal(pack().follow, true, "the old switch was not written with it");
  // The packing now starts the minute the oven ends its own lot — 8:15 am against
  // the 8:57 am she had it at, on every one of its four lots.
  assert.deepEqual(starts(state, "solo_pack"), [255, 342, 429, 516], "the packing did not land on the end of the oven");
  // Nothing above it moved, so what she sets below can never re-lay the day above her.
  assert.deepEqual(starts(state, "solo_oven"), [240, 327, 414, 501], "setting the packing moved the oven");
  // And the day still makes what it made: a tight follow takes the waiting out, not
  // the pans.
  assert.equal(computeScenario(state.settings.scenario).pansPerDay, 24, "the answer she picked changed how many pans the day makes");
  assert.ok(px(rowFor(root, "Cutting and packing")[0], "left") < before, "the bar was not redrawn where the new answer puts it");
});

test("a module that waits keeps the later time she set, and one that follows does not (v154)", () => {
  const { root, state } = render();
  const pack = () => state.settings.scenario.modules.find((m) => m.id === "solo_pack");
  const was = starts(state, "solo_pack");

  // "Never before the one above finishes" is the floor, and the floor is what her
  // saved modules already behave with: a time she set that is already the later one
  // stands exactly where it is.
  openModule(root, "Cutting and packing");
  popupButton(/Never before the one above finishes/).dispatchEvent({ type: "click" });
  assert.equal(pack().startMode, "wait");
  assert.deepEqual(starts(state, "solo_pack"), was, "the floor moved a time it should have left alone");

  // "As the one above finishes" is the tight follow, and it is the only one of the
  // three that can pull a lot EARLIER — which is the whole of her first report.
  popupButton(/As the one above finishes/).dispatchEvent({ type: "click" });
  assert.deepEqual(starts(state, "solo_pack"), [255, 342, 429, 516], "the tight follow did not pull the packing onto the oven");
  for (let k = 0; k < 4; k += 1) {
    assert.ok(starts(state, "solo_pack")[k] < was[k], `packing lot ${k + 1} was not pulled earlier`);
  }
});

test("every batch's own card offers the pair, on a module that waits included (v154)", () => {
  const { root, state } = render();
  const pack = () => state.settings.scenario.modules.find((m) => m.id === "solo_pack");
  const was = starts(state, "solo_pack").slice();

  // Her report: "The delta t disappeared, before this we have it. I want each batch
  // start time to be adjustable, like the 1st module." Batch 2 of the last module
  // used to be refused the pair outright, with a sentence telling her to go and
  // change the module instead.
  tapBar(root, "Cutting and packing", 1);
  assert.match(popupBody(), /Batch 2/, "batch 2's own card did not open");
  const later = popupButton(/\+ 5 min/);
  assert.ok(later, "batch 2's card offers no way to move it");
  later.dispatchEvent({ type: "click" });

  // Below batch 1 the lot rides the module above, so its move is written as a hold
  // on that lot — not as a start time, which the line would overwrite on the next
  // repaint.
  assert.equal(pack().startDelta[1], 5, "the move on batch 2 was not written as a hold on batch 2");
  assert.equal(pack().startDelta[0], 0, "moving batch 2 moved batch 1");
  assert.equal(starts(state, "solo_pack")[1], was[1] + 5, "batch 2 did not move");
  assert.equal(starts(state, "solo_pack")[2], was[2], "a batch after the one she moved came with it");
  assert.match(lastToast(), /Batch 2 held back 5 minutes/, "the move did not say what it did");

  // And it is not a one-way door: the card offers the way back, on that batch alone.
  popupButton(/Back onto the line/).dispatchEvent({ type: "click" });
  assert.equal(pack().startDelta[1], 0, "the way back left the batch held");
  assert.deepEqual(starts(state, "solo_pack"), was, "the way back did not put the batch where it was");
});

test("batch 1 reads this module's offset, and the batches below it read as riding the line (v154)", () => {
  const { root } = render();
  // Her ask: "Just need to show delta on the batch 1st offset only, then following
  // module of that step dont have to show the delta because it follow the previous
  // module tightly." Read on the oven, which is a module in the middle of her day:
  // the last module's first batch opens the day's own card (v152) and the first
  // module's first batch is its own start time, so neither is where an offset from
  // a module above would be read.
  openModule(root, "The oven swap and the bake");
  popupButton(/Never before the one above finishes/).dispatchEvent({ type: "click" });

  // Batch 1 of a module below the first carries the module's own answer about the
  // module above it.
  tapBar(root, "The oven swap and the bake", 0);
  assert.match(popupBody(), /never before the module above/, "batch 1 does not read this module's own answer");
  assert.doesNotMatch(popupBody(), /Δt =/, "a batch that is not held claims an offset it does not have");

  // The batches below it do not repeat the module's offset, because they ride the
  // module above at this module's own pace and there is nothing of the module's to
  // read on them.
  tapBar(root, "The oven swap and the bake", 2);
  assert.match(popupBody(), /on the line/, "a later batch does not read as riding the line");
  assert.doesNotMatch(popupBody(), /never before the module above/, "a later batch repeats the module's own offset");

  // A batch she HAS held says so on its own card, because a lot that is off the
  // line must never look like one that is on it.
  popupButton(/\+ 5 min/).dispatchEvent({ type: "click" });
  assert.match(popupBody(), /Δt = \+5 min/, "a held batch does not read out its own hold");
});

// Her own day with one more step after the packing. The last module of the build
// is where batch 1 opens the day's own card (v152), so a test about a batch card at
// the packing needs the packing to not be the last thing she does.
const oneMore = () => render({
  modules: [
    ...ONE_BAKER_SCENARIO.modules.map((m) => ({ ...m, cycles: (m.cycles || []).map((c) => ({ ...c })) })),
    {
      id: "solo_label", icon: "🏷️", name: "Labelling and boxing", on: true, job: "", cycleMin: 5, batch: 1,
      touchMin: 5, everyMin: 87, everyAuto: false, repeats: 4, repeatsAuto: false, startMin: 320,
      startMode: "own", follow: false, overlap: true, people: 1, person: 0, crew: [0], count: 1,
      cycles: [{ name: "", min: 5, load: 5, unload: 0 }],
    },
  ],
});

test("a press on batch 1 of a module that follows holds that batch alone, and there is a way back (v182)", () => {
  const { root, state } = oneMore();
  const pack = () => state.settings.scenario.modules.find((m) => m.id === "solo_pack");
  openModule(root, "Cutting and packing");
  popupButton(/As the one above finishes/).dispatchEvent({ type: "click" });

  // A module set this way has no start time of its own to write — it begins where
  // the oven ends, whatever a stored start says — so a press that wrote one would
  // be a button that does nothing. It writes a hold, and since v182 that hold
  // belongs to the batch she pressed and to no other.
  const was = starts(state, "solo_pack").slice();
  tapBar(root, "Cutting and packing", 0);
  popupButton(/\+ 5 min/).dispatchEvent({ type: "click" });

  assert.deepEqual(pack().startDelta.slice(0, 4), [5, 0, 0, 0], "the press moved batches it was not pressed on");
  const now = starts(state, "solo_pack");
  assert.equal(now[0], was[0] + 5, "batch 1 did not move");
  for (let k = 1; k < 4; k += 1) assert.equal(now[k], was[k], `lot ${k + 1} came with batch 1`);
  assert.match(lastToast(), /Batch 1 held back 5 minutes/, "the press did not name the batch it moved");

  // The batches below it are free to be moved the same way, each on its own.
  tapBar(root, "Cutting and packing", 2);
  popupButton(/\+ 5 min/).dispatchEvent({ type: "click" });
  assert.deepEqual(pack().startDelta.slice(0, 4), [5, 0, 5, 0], "the second press did not hold its own batch alone");

  // An earlier press can only ever take that batch's hold off again, and it cannot
  // go past the line: below zero there is nothing left to take off, and the card
  // says so rather than quietly doing nothing.
  popupButton(/Back onto the line/).dispatchEvent({ type: "click" });
  assert.deepEqual(pack().startDelta.slice(0, 4), [5, 0, 0, 0], "the way back took off a hold it was not standing on");
  assert.deepEqual(starts(state, "solo_pack"), was.map((x, i) => (i === 0 ? x + 5 : x)),
    "the way back did not put batch 3 where it was");
  assert.match(lastToast(), /Batch 3 back at/, "the way back did not name the batch it put back");

  popupButton(/− 5 min/).dispatchEvent({ type: "click" });
  assert.deepEqual(pack().startDelta.slice(0, 4), [5, 0, 0, 0], "a press took the batch past the line");
  assert.match(lastToast(), /nothing left to take off/, "a batch with nothing left to take off did not say so");
});

// Her report of 23 September, in her own words: "i ask for delta time, that
// function is not worker across the chart ... Before this the delta t was there,
// why it disappeared. And the ruturn to original button is missing?" Both were
// real, and both had one cause. v154 narrowed the batch card's move to a hold only
// "below batch 1, or batch 1 of a module set to start as the one above finishes",
// and every module of her own day is set to its own time — so batch 1 of every
// module took the absolute path, no hold was ever written, no Δt was ever drawn
// anywhere on her chart, and the card's own way back, which only exists while a
// hold does, went with it.
//
// Her report of 24 September then took the last of batch 1's privileges: "delta t
// on one batch of the module dont change the module batches, it should not be."
// Measured on her own day before anything was changed, holding batch 1 of The oven
// swap and the bake by five minutes read [240, 327, 414, 501] before and
// [245, 332, 419, 506] after — all four batches — while holding batch 3 by the same
// five minutes moved batch 3 alone. One press moves one batch, on every module.
test("a press holds the batch it was pressed on, and only that one, on a module that keeps its own time (v182)", () => {
  const { root, state } = render();
  const oven = () => state.settings.scenario.modules.find((m) => m.id === "solo_oven");
  const was = starts(state, "solo_oven").slice();

  tapBar(root, "The oven swap and the bake", 0);
  popupButton(/\+ 5 min/).dispatchEvent({ type: "click" });

  // A HOLD, not a start time: this is the reading v154 took away, and it is what
  // the chart's own Δt badge is written from. It belongs to batch 1 and to nothing
  // else — the three batches under it stay exactly where the line put them.
  assert.ok(Array.isArray(oven().startDelta),
    "the move on batch 1 was written as a start time instead of a hold");
  assert.deepEqual(oven().startDelta.slice(0, 4), [5, 0, 0, 0],
    "the press moved batches it was not pressed on");
  const now = starts(state, "solo_oven");
  assert.equal(now[0], was[0] + 5, "batch 1 did not move");
  for (let k = 1; k < 4; k += 1) assert.equal(now[k], was[k], `lot ${k + 1} came with batch 1`);
  assert.match(lastToast(), /Batch 1 held back 5 minutes/,
    "the press did not name the batch it moved");
  assert.match(popupBody(), /Δt = \+5 min/, "the card does not read the hold out");
  assert.equal(textOf(tagsFor(root, "The oven swap and the bake")[0]).trim(), "B1 Δt=+5",
    "the chart's own badge lost the Δt");

  // And the door has a handle again, on the batch that moved — and on that one only.
  // So batch 3 is given a hold of its own first: taking batch 1 back must leave it
  // standing, which is the same rule read from the other end.
  tapBar(root, "The oven swap and the bake", 2);
  popupButton(/\+ 5 min/).dispatchEvent({ type: "click" });
  assert.deepEqual(oven().startDelta.slice(0, 4), [5, 0, 5, 0],
    "a hold on batch 3 landed somewhere other than on batch 3");
  tapBar(root, "The oven swap and the bake", 0);
  const back = popupButton(/Back onto the line/);
  assert.ok(back, "the batch card offers no way back after a move");
  back.dispatchEvent({ type: "click" });
  assert.deepEqual(oven().startDelta.slice(0, 4), [0, 0, 5, 0],
    "the way back took off a hold it was not standing on");
  assert.deepEqual(starts(state, "solo_oven"), [was[0], was[1], was[2] + 5, was[3]],
    "the way back did not put the batch where it was, or moved another one");
  assert.doesNotMatch(textOf(tagsFor(root, "The oven swap and the bake")[0]), /Δt/,
    "the badge kept a hold that is off");
  assert.match(textOf(tagsFor(root, "The oven swap and the bake")[2]), /Δt=/, "batch 3 lost the hold it still has");
});

// Her rule for the badge when the row runs out of room, in her own words: "if the
// scale is too wide to show batch no. and delta t then forgo delta t". So the
// number — the thing that tells one batch from another — always stays, and the
// hold is printed only above the widest stop.
test("at the widest scale the batch number stays and the Δt is forgone (v179)", () => {
  const held = () => ONE_BAKER_SCENARIO.modules.map((m) => (m.id === "solo_oven" ? { ...m, startDelta: [5, 0, 0, 0] } : { ...m }));
  const tagAt = (px) => {
    const { root } = render({ modules: held(), pxPerMin: px });
    return tagsFor(root, "The oven swap and the bake")[0];
  };

  assert.equal(textOf(tagAt(1.2)).trim(), "B1", "the widest scale printed the hold it has no room for");
  // The tint is not room: it still answers which of the batches is held.
  assert.ok(hasClass(tagAt(1.2), "nudged"), "the held batch lost its tint at the widest scale");
  // And the three nearer stops all keep the reading.
  for (const px of [1.6, 2.4, 3.2]) {
    assert.equal(textOf(tagAt(px)).trim(), "B1 Δt=+5", `the ${px} stop dropped a hold it has room for`);
  }
});

test("the people are held below the modules, so a slot can be read against any module (v154, v167)", () => {
  const { root } = render();
  // Her ask: "I want to freeze the persons card, so that by scrolling thru modules
  // i can see exactly where that slot of that person tie up to and searching for
  // opportunity to move some batch start time to reduce the number of person
  // needed." The modules scroll; the people do not.
  //
  // The guarantee is the same one at v167 and it is kept by a stronger mechanism:
  // the people are not pinned inside the modules' panel any more, they are in a
  // window of their own below it, so no module row can reach them at any height.
  const people = walk(root).find((n) => hasClass(n, "tl-people"));
  assert.ok(people, "the people rows are not held in a block of their own, so they scroll away with the modules");

  // Every person's row is inside it, and no module row is.
  const inside = walk(people);
  assert.ok(inside.some((n) => hasClass(n, "tl-row") && hasClass(n, "person") && textOf(n).includes("Person 1")),
    "the person rows are not in the held block");
  // A MODULE row, and the class is what makes that a real assertion rather than a
  // lucky one: since v158 a person's row carries the jobs they do in its tip, so
  // "Cutting and packing" is now a name that appears inside the held block legit —
  // it is one of Person 1's jobs. The row wearing the name is the module row.
  assert.equal(inside.filter((n) => hasClass(n, "tl-row") && !hasClass(n, "person")
    && textOf(n).includes("Cutting and packing")).length, 0,
    "a module row is inside the held block, so the block is not the people");
  // Drawn once, not once per module.
  assert.equal(walk(root).filter((n) => hasClass(n, "tl-people")).length, 1, "the people block is drawn more than once");

  // And it is held by the shape of the chart rather than by hope: since v167 it sits
  // in a scrolling window of its own below the modules' window, so the modules'
  // scrolling cannot reach it at any height — which is what the sticky foot was
  // reaching for, and what left 177px of blank window under the people when the day
  // was shorter than the fixed panel.
  const pane = walk(root).find((n) => hasClass(n, "tl-pane-people"));
  assert.ok(pane, "the people have no window of their own, so they are inside the modules' panel again");
  assert.ok(walk(pane).includes(people), "the people block is not inside the people's window");
  const proc = walk(root).find((n) => hasClass(n, "tl-pane-proc"));
  assert.ok(proc, "there is no window for the modules");
  assert.ok(!walk(proc).includes(people),
    "the people block is inside the modules' window, so scrolling the modules still moves it");
  // Both windows scroll, or a row cannot be panned to at all — and the class that
  // carries the scrolling is the one rule they share.
  assert.ok(hasClass(pane, "tl") && hasClass(proc, "tl"),
    "a window does not wear the scrolling class, so its rows cannot be panned");

  // The block itself is opaque (the windows are drawn over each other's edges), and
  // the people's window is capped, or it would grow into the modules' window.
  const css = read("admin/css/app.css");
  assert.match(css, /\.tl-people\s*\{[^}]*background:/, "the people block is see-through, so the modules show through it");
  assert.match(css, /\.tl-pane-people\s*\{[^}]*max-height/, "the people's window has no cap, so it can grow into the modules'");
});

// ── v155: the module row is the height of its bars ──────────────────────────
//
// Her report of 22 September: "The window for scrolling module became too small,
// why not reduce the height of each module, the notes can just shown up upon mouse
// hoover." The two notes under every module name were what made a row tall — on her
// own day they ran to 912px of rows inside a 536px window. They are off the row
// now, printed instead on the module's own card, which is what a tap on the row
// opens; a computer gets them back under the pointer, where there is a pointer.

test("a module row carries its notes but does not print them, and its card does (v155)", () => {
  const { root } = render();
  const row = walk(root).find((n) => hasClass(n, "tl-row") && textOf(n).includes("Mixing the dough in the tub"));
  assert.ok(row, "no timeline row for the mixing module");

  // Both notes are still built and still say what they said — they are carried, not
  // dropped, so the card below and a computer's hover can print them word for word.
  const held = walk(row).filter((n) => hasClass(n, "tl-tip"));
  assert.equal(held.length, 1, "the row does not carry exactly one tip");
  assert.match(textOf(held[0]), /starts 4:01 am · 4 batches/,
    `the tip no longer says when the module starts: ${textOf(held[0])}`);
  assert.match(textOf(held[0]), /20 min a batch · 20 min of you/,
    `the tip no longer says what a batch costs: ${textOf(held[0])}`);
  // The same two sentences, as two lines rather than one run together.
  assert.equal(walk(held[0]).filter((n) => hasClass(n, "tl-sub")).length, 2,
    "the tip does not hold the module's two notes as two lines");

  // The card the row's tap opens carries both, at the top, before anything else.
  openModule(root, "Mixing the dough in the tub");
  const body = popupBody();
  assert.match(body, /starts 4:01 am · 4 batches/, "the module card does not carry the row's first note");
  assert.match(body, /20 min a batch · 20 min of you/, "the module card does not carry the row's second note");
});

// ── v156: the tip does not expand the module ────────────────────────────────
//
// Her correction of 22 September, on seeing it described: "i prefer not to expend
// the module with mouse hoover. Remain the height. When mouse hoover to the module
// title, only the note should shot as a too tip". v155 revealed the notes by making
// the row taller, which is the very thing this release exists to stop: a row that
// grows under the pointer moves everything below it, so the bar she was reading is
// no longer where she left it. The notes are laid OVER the day instead, from the
// title cell alone, and the row's height is the same whether or not the tip is open.

test("the notes open as a tip over the day, and the row keeps its height (v156)", () => {
  const css = read("admin/css/app.css");

  // Hidden until the title is pointed at, and taken out of the row's flow while it
  // is showing: absolute is what keeps the height. A revealed block here would be
  // v155 again, and the row would grow by two lines the moment she pointed at it.
  assert.match(css, /\.tl-tip\s*\{[^}]*display:\s*none/, "the tip is not off the row, so the row is still as tall as its notes");
  assert.match(css, /\.tl-tip\s*\{[^}]*position:\s*absolute/, "the tip is laid out in the row, so opening it moves every row below it");
  assert.match(css, /\.tl-tip\s*\{[^}]*top:\s*50%[^}]*translateY\(-50%\)/, "the tip is not centred on the row it belongs to");

  // Opened by the title cell, and only by it — she asked for the note, not for the
  // row to react — and only where there is a pointer that can hover. A phone has no
  // hover, so a reveal tied to one would be a reveal her phone can never reach.
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.tl-name:hover\s+\.tl-tip\s*\{\s*display:\s*block/,
    "the tip is not opened by pointing at the module's own title");
  assert.ok(!/\.tl-row:hover[^{]*\{[^}]*display:\s*block/.test(css),
    "something on the row is still revealed in the row's own flow, which is what grew it");

  // And the height it must not change: the box is capped under the row's own 46px,
  // so a tip on the first or the last module of a long day is not cut by the edge of
  // the scrolling panel.
  assert.match(css, /\.tl-tip\s+\.tl-sub\s*\{[^}]*line-height:\s*1\.3/, "the tip's two lines are not held to a height that fits inside a row");
});


test("the name takes the whole of the row's first line (v155)", () => {
  const { root } = render();
  const row = walk(root).find((n) => hasClass(n, "tl-row") && textOf(n).includes("The rests and the stretch and folds"));
  const top = walk(row).find((n) => hasClass(n, "tl-name-top"));
  const name = walk(top).find((n) => hasClass(n, "tl-name-txt"));
  assert.ok(name, "the name is not in a span of its own, so a long one cannot be shortened");
  assert.equal(textOf(name).trim(), "🫙 The rests and the stretch and folds", "the row stopped naming the module in full");

  // Sharing the name's line was the real damage: this module's name is 273px wide
  // and a badge beside it left 35px of it to read. The name takes the whole line,
  // and a badge — if one were ever put back here — breaks onto the one below,
  // which is 16px, under the 45px the bars already ask for, so the row is no
  // taller for it.
  const css = read("admin/css/app.css");
  assert.match(css, /\.tl-name-top\s*\{[^}]*flex-wrap:\s*wrap/, "the name and its badges could never break onto two lines");
  assert.match(css, /\.tl-name-txt\s*\{[^}]*flex:\s*1 1 100%/, "the name does not take the line it is on");
  assert.match(css, /\.tl-name-txt\s*\{[^}]*text-overflow:\s*ellipsis/, "a long name is not shortened, so it wraps the row taller than its bars");
  // And the column those 156px of name live in, measured rather than promised.
  assert.match(css, /\.tl-name\s*\{[^}]*width:\s*156px/, "the name column is not the width the row was measured at");
});

// ── v157: every tag leaves the row, for the tip and the card ─────────────────
//
// Her ask of 22 September: "The module tag, can you put them in the tip tips?"
// and then, asked which ones, "Every tag, into the tip". The badges were the last
// words left on the row, and every word on the row is height the modules window
// cannot have. They are everywhere the notes already are — in the tip a computer
// opens under the pointer, and written out on the card her tap opens, which is
// where a phone reads them, because a finger has no hover to open a tip with.

test("every module tag is off the row, and in the tip and on the card instead (v157)", () => {
  const { root } = render();

  // Not one badge on any row of the whole day — not on a name cell and not beside
  // one. The row is the name and its bars and nothing else, which is what makes it
  // 46px and what the 54 pixels the old badges cost her phone buy back.
  const rows = walk(root).filter((n) => hasClass(n, "tl-row"));
  const onRow = rows.flatMap((r) => walk(r)).filter((n) => hasClass(n, "badge"));
  assert.equal(onRow.length, 0, `a tag is still on a row: ${onRow.map((n) => textOf(n).trim()).join(" / ")}`);

  // Every tag the tip carries is the same tag the module's own card carries, word
  // for word. That is the whole promise of the move: nothing is lost, it is only
  // somewhere a phone can reach it — a finger has no hover to open a tip with.
  const tagged = rows.filter((r) => walk(r).some((n) => hasClass(n, "tl-tag-line")));
  assert.ok(tagged.length, "no row carries a tag line at all, so the tags went nowhere");
  for (const row of tagged) {
    const named = walk(row).find((n) => hasClass(n, "tl-name-txt"));
    if (!named) continue; // a second production line: its tags are the module's, on line 0
    const name = textOf(named).replace(/\s+/g, " ").trim().replace(/^\S+\s+/, "");

    const held = walk(row).find((n) => hasClass(n, "tl-tip"));
    const tagLine = walk(held).find((n) => hasClass(n, "tl-tag-line"));
    // The tag line is the first of the tip's three lines, because it is the
    // shortest of them to read.
    assert.equal(walk(held).filter((n) => hasClass(n, "tl-sub"))[0], tagLine,
      `the tag line is not the first line of the tip on ${name}`);
    const said = textOf(tagLine).replace(/\s+/g, " ").trim();

    openModule(root, name);
    const cardTags = walk(layers["popup-layer"]).find((n) => hasClass(n, "tl-tag-row"));
    assert.ok(cardTags, `the card for ${name} has no tag row, so a phone cannot read its tags`);
    const onCard = walk(cardTags).filter((n) => hasClass(n, "badge")).map((n) => textOf(n).replace(/\s+/g, " ").trim());
    assert.equal(onCard.join(" · "), said, `the tip and the card disagree about ${name}`);
  }
});

test("tags that only exist for a repeated module are carried the same way (v157)", () => {
  // Two of the module: it wears "2 of them", which no number in the bars says.
  const modules = ONE_BAKER_SCENARIO.modules.map((m) => (m.id === "solo_scale" ? { ...m, count: 2 } : { ...m }));
  const { root } = render({ modules });

  const rows = walk(root).filter((n) => hasClass(n, "tl-row"));
  assert.equal(rows.flatMap((r) => walk(r)).filter((n) => hasClass(n, "badge")).length, 0,
    "a tag is still on a row of a repeated module");

  openModule(root, "Oil the pans");
  const cardTags = walk(layers["popup-layer"]).find((n) => hasClass(n, "tl-tag-row"));
  assert.ok(cardTags, "the card of a repeated module has no tag row");
  assert.match(textOf(cardTags), /2 of them/, `the card does not say how many of it there are: ${textOf(cardTags)}`);
});

// The tip is three lines now — the tags, then when the module starts, then what a
// batch costs — which is taller than the 46px row it belongs to. It is still not
// cut by the edge of the scrolling panel, and that is not luck: it is centred on
// its own row, so half the box goes into the slack above the first module (the
// clock strip) or below the last one (the person rows).
test("the three-line tip is held inside the panel it is drawn in (v157)", () => {
  const css = read("admin/css/app.css");
  assert.match(css, /\.tl-tip\s*\{[^}]*max-width:\s*min\(340px, calc\(100vw - 240px\)\)/,
    "a wide tag line can run the tip off the right edge of the panel");
  assert.match(css, /\.tl-tip\s+\.tl-tag-line\s*\{[^}]*white-space:\s*normal/,
    "the tag line cannot wrap, so a long one widens the box instead of folding");
  assert.match(css, /\.tl-tip\s*\{[^}]*top:\s*50%[^}]*translateY\(-50%\)/,
    "the tip is not centred on its row, so a first or last module's tip is cut in half");
});

// ── v157: a shorter control list, so the modules window gets the room ────────
//
// Her words: "Make the scale with + -, People: make it drop down option, The
// line: this name is very unclear, we just need the button, WORK BACKWARD. The
// idea is to make this list shorter and make room for a bigger modules windows."
// Four named stops became two presses, three People chips became one drop-down
// whose closed text is the arrangement in force, the "The line" group left the
// row for the module card, and the day-backwards group lost its label and kept
// only the button.

test("the scale is two presses around the name of the stop it is on (v157)", () => {
  const { root } = render();
  const group = ctlGroup(root, "Scale");

  const steps = walk(group).filter((n) => hasClass(n, "tl-step"));
  assert.equal(steps.length, 2, `the scale is not exactly two presses: ${steps.length}`);
  assert.deepEqual(steps.map((n) => textOf(n).trim()), ["−", "+"], "the two presses are not a minus and a plus");
  // Each press says out loud what it will do, because a lone − and + on a phone
  // says nothing about which way the day is about to move.
  assert.match(steps[0].attrs["aria-label"] || "", /wider/i, "the minus does not say it widens the view");
  assert.match(steps[1].attrs["aria-label"] || "", /closer/i, "the plus does not say it closes in");

  // Between them, the name of the stop the view is on — the names v154 put in chips,
  // kept as a read-out rather than as taps. Walked one stop at a time and compared
  // as a whole list rather than pattern-matched: /Close/ is a substring of "Closer"
  // and of "Closest", so a regex would happily agree with a names array that had
  // lost an entry — and a lost entry prints an empty chip, which is the fault this
  // is here to catch.
  const names = [1.2, 1.6, 2.4, 3.2, 4.8, 7.2].map((pxPerMin) => {
    const named = walk(render({ pxPerMin }).root).find((n) => hasClass(n, "tl-step-name"));
    return named ? textOf(named).trim() : "(nothing)";
  });
  assert.deepEqual(names, ["Wide", "Standard", "Close", "Closer", "Closest", "Detail"],
    `the dial does not name every stop it can be turned to: ${names.join(" / ")}`);

  // The chips are gone — a shorter row was the whole point of the change.
  assert.equal(walk(group).filter((n) => hasClass(n, "tl-chip")).length, 0, "the scale chips are still in the row");

  // And the presses do move the view, one stop at a time: on + the day is drawn
  // closer, and at the closest stop the + is itself switched off rather than
  // running past the end of the dial and leaving her day off the screen.
  const { root: r2, state } = render();
  const before = state.settings.scenario.pxPerMin;
  walk(r2).filter((n) => hasClass(n, "tl-step"))[1].dispatchEvent({ type: "click" });
  assert.ok(state.settings.scenario.pxPerMin > before, "the closer press did not close the view in");

  const end = render({ pxPerMin: 1000 });
  assert.equal(walk(end.root).filter((n) => hasClass(n, "tl-step"))[1].disabled, true,
    "the closer press is still live at the closest stop");
  const start = render({ pxPerMin: 0.1 });
  assert.equal(walk(start.root).filter((n) => hasClass(n, "tl-step"))[0].disabled, true,
    "the wider press is still live at the widest stop");
});

test("every stop of the dial has a name and a ruler step (v184)", () => {
  // Three tables read by index off one list: PX_PER_MIN_CHOICES in the model, and
  // SCALE_NAMES and TICK_MIN in the view. A stop with no name prints an empty chip,
  // which the walk above catches. A stop with no RULER step is worse than that, and
  // is what this is really for: rulerRow steps by that number in a `for` loop, so an
  // undefined step is not a coarse ruler, it is a loop that never advances. Both
  // tables are private to the view, so they are counted where they are written.
  const list = (src, name) => {
    const m = src.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
    assert.ok(m, `${name} is not a table of its own any more`);
    return m[1].split(",").map((s) => s.trim()).filter(Boolean);
  };
  const stops = list(read("admin/js/scenario.js"), "PX_PER_MIN_CHOICES").length;
  const view = read("admin/js/views/scenario.js");

  assert.equal(list(view, "SCALE_NAMES").length, stops,
    "the dial has a stop it cannot name, so she would be standing on a chip that reads as nothing");
  assert.equal(list(view, "TICK_MIN").length, stops,
    "the ruler has no step for the closest stop, so the ruler cannot be drawn at all");
});

test("the people are one drop-down, and its closed text is the arrangement in force (v157)", () => {
  const { root } = render();
  const people = ctlGroup(root, "People");
  const sel = walk(people).find((n) => n.tagName === "SELECT" && hasClass(n, "tl-select"));
  assert.ok(sel, "the people are not a drop-down any more");

  // One placeholder that shows as the closed control's own text, and three answers
  // behind it. The placeholder is what she has now rather than an instruction — a
  // control that only ever said "choose" would hide the answer she came here to read.
  const options = walk(sel).filter((n) => n.tagName === "OPTION");
  assert.equal(options.length, 4, `the drop-down does not hold a reading and three answers: ${options.length}`);
  const showing = options[0];
  assert.ok(showing.disabled && showing.selected, "the drop-down's closed text is not the reading");
  assert.ok(sel.value === "" || sel.value === undefined, "the drop-down opens on an answer rather than on the reading");
  assert.match(textOf(showing), /Sharing|One a module|One a line|Your own|Combined/,
    `the closed control reads "${textOf(showing).trim()}", which is not the arrangement in force`);

  const labels = options.slice(1).map((n) => textOf(n));
  assert.ok(labels.some((l) => /One a module|One a line/.test(l)), `no one-to-a-job answer: ${labels.join(" / ")}`);
  assert.ok(labels.some((l) => /Share them out/.test(l)), `no share-them-out answer: ${labels.join(" / ")}`);
  assert.ok(labels.some((l) => /Combine two people/.test(l)), `no combine answer: ${labels.join(" / ")}`);

  // And the three People chips v154 put in the row are gone, replaced by this one
  // control rather than sitting beside it.
  assert.equal(walk(people).filter((n) => hasClass(n, "tl-chip")).length, 0, "the People chips are still in the row");
});

test("the line's own group has left the control row for the module card (v157)", () => {
  const { root } = render();

  // Off the row: neither its label nor the bulk presses that lived under it. The
  // name was the part she could not read — "this name is very unclear" — and the
  // presses set a thing that is set per module anyway, beside the three answers
  // that already do exactly that.
  const ctl = walk(root).find((n) => hasClass(n, "tl-ctl"));
  assert.ok(ctl, "the controls row is gone altogether");
  assert.ok(!/\bline\b/i.test(walk(ctl).filter((n) => hasClass(n, "tl-ctl-lab")).map((n) => textOf(n)).join(" ")),
    "the controls row still carries a label about the line");
  assert.equal(walk(ctl).filter((n) => n.tagName === "BUTTON" && /^Chain |Take the waiting off/.test(textOf(n).trim())).length, 0,
    "the chain-the-line press is still in the controls row");

  // And on the card, which is what she asked for: "put into the module card".
  openModule(root, "Mixing the dough in the tub");
  assert.match(popupBody(), /Waiting on the module above/, "the module card does not carry the line's own words");
  assert.match(popupBody(), /Nothing is waiting right now|waits? on the module above/,
    "the card does not say what is waiting, which is what the group was for");
  assert.ok(walk(layers["popup-layer"]).some((n) => n.tagName === "BUTTON" && /Chain every module/.test(textOf(n))),
    "the module card offers no way to chain the line");

  // Everything the chip's own card carried comes with the move, or it is not a move
  // but a deletion: the three cost numbers were on that card, and a card that lost
  // them while gaining the presses would be quietly thinner than the thing it
  // replaced. The numbers are the day's own, in the shape the chip's card used.
  assert.match(popupBody(), /\bperson\b|\bpeople\b/, "the card lost the count of people the chip's card carried");
  assert.match(popupBody(), /of hands/, "the card lost the hands figure the chip's card carried");
  assert.match(popupBody(), /day\./, "the card lost the length of the day the chip's card carried");
});

// ── v157: a taller window ────────────────────────────────────────────────────

test("the modules window is taller, and the paragraphs above it are gone (v157, v167)", () => {
  const { root } = render();

  // Her first ask, "i want to make the modules window taller", and her last,
  // "remove?" on the two paragraphs.
  //
  // v157 answered the height with a floor and a raised cap, and v159 replaced both
  // with ONE height — which v167 then split between two windows, because that one
  // height was also a FLOOR and her report of 23 September was the blank space it
  // left under the people. What v157 was for is kept: each window is still a window,
  // still capped, and still scrolls. The cap moved from .tl onto the panes, because
  // two windows of different sizes cannot share one number.
  const css = read("admin/css/app.css");
  const procRule = /\.tl-pane-proc\s*\{[^}]*\}/.exec(css);
  assert.ok(procRule, "the modules have no window of their own");
  assert.match(procRule[0], /max-height:\s*min\(/, "the modules window has no cap, so it is not a window");
  assert.match(css, /\.tl\s*\{[^}]*overflow:\s*auto/, "the windows no longer scroll");
  // And the rubber band is still gone. A cap says where growth STOPS; the fault of
  // v159 was a FLOOR, which says where it starts whether the day wants it or not.
  // The shared rule must carry neither, and no height at all.
  const tlRule = css.slice(css.indexOf(".tl {"), css.indexOf("}", css.indexOf(".tl {")));
  assert.doesNotMatch(tlRule, /min-height/, "the windows still have a floor, so their height is the day's again");
  assert.doesNotMatch(tlRule, /[^-]height\s*:/, "the windows carry a fixed height again, which is the blank space she reported");

  // The two paragraphs above the chart are gone from the day card, and so is the
  // signpost that named the day-backwards control: the button names itself.
  const src = read("admin/js/views/scenario.js");
  assert.doesNotMatch(src, /dayBackSignpost/, "the removed day-backwards signpost is still built");
});

test("the day-backwards group is the button and nothing else (v157)", () => {
  const { root } = render();
  const group = dayBackGroup(root);

  // "we just need the button, WORK BACKWARD" — no label over it, and no clock in
  // the label. The button's own words say what it does.
  assert.equal(walk(group.el).filter((n) => hasClass(n, "tl-ctl-lab")).length, 0,
    "the day-backwards group has a label above the button again");
  const buttons = walk(group.el).filter((n) => n.tagName === "BUTTON");
  assert.equal(buttons.length, 1, `the group is not one button: ${buttons.map(textOf).join(" / ")}`);
  assert.match(textOf(buttons[0]), /Work the day backwards/, "the button stopped saying what it does");
});

// ── v158: the people rows come down to one line, the tally becomes a ruler ──
//
// Her ask of 22 September, following v157: "can i have all the peoples cards
// noted in tool tips as well?" — and then, asked how far it should go, "not on
// the whole roll, just the title. The height of people is fix. show everything
// about them in tooltips". So the people rows and the tally at the foot of the
// day keep what every module row already keeps: the name and nothing else, with
// everything they have to say in a tip on the title.
//
// The height is the point of it. A person's row was ≈42px and ≈56px on a day
// where two of their jobs collided, against a module row's 46px — so the strip
// pinned to the foot of the panel grew and shrank as she scrolled the day, which
// is the one thing v157's window was for.

// Every person row in the held block: the people, never the tally.
function personRows(root) {
  return walk(root).filter((n) => hasClass(n, "tl-row") && hasClass(n, "person") && !hasClass(n, "total-row"));
}
const nameCell = (row) => walk(row).find((n) => hasClass(n, "tl-name"));
// ── The two windows (v167, v168) ────────────────────────────────────────────
// Her ask: "instead of consider then one window, why not create 2 windows, and let
// the ruler sync in the 2 windows". The slider that first sat between them is gone —
// "since the both windows have their own slider, additional slider is redundent.
// Remove that" — so there is no helper for one: each window's own bar is the pan,
// and wirePaneScroll keeps the two in step.
const paneOf = (root, which) => walk(root).find((n) => hasClass(n, `tl-pane-${which}`));
const wrapOf = (root) => walk(root).find((n) => hasClass(n, "tl-wrap"));
// Give both windows the box a real browser would: a day wider than the window, so
// there is something to pan. Written onto the nodes rather than into a render
// option, because this is geometry rather than app state.
function giveThemAWindow(root, scrollWidth = 2000, clientWidth = 600) {
  const panes = [paneOf(root, "proc"), paneOf(root, "people")];
  for (const p of panes) { p.scrollWidth = scrollWidth; p.clientWidth = clientWidth; }
  return panes;
}
// The shim hands every node the same box, which cannot tell the fourth row of a list
// from the last — so a render that has to be MEASURED is built inside this, and each
// node is given a box of its own, in the order it was built. Whether the shelf measured
// the fourth row or the sixth is then a number rather than a hope.
const boxes = (build) => {
  const real = globalThis.document.createElement;
  let n = 0;
  globalThis.document.createElement = (tag) => {
    const node = real(tag);
    n += 1;
    // Each node ten pixels higher up the page than the last one built, so the rows
    // stack in the order they are drawn and the shelf — built last, once the whole
    // table is inside it — starts above all of them, as the real box does.
    node._rect = { left: 0, top: -(n * 10), width: 315, height: 10 };
    return node;
  };
  try { return build(); } finally { globalThis.document.createElement = real; }
};

// A px value out of a node's own style object — `cursor.style.left`, which is how
// the view places a hairline — as opposed to px(), which reads the style STRING a
// builder was handed.
function stylePx(node, key) {
  const m = /(-?\d+(?:\.\d+)?)px/.exec(String(node.style[key] || ""));
  return m ? Number(m[1]) : null;
}
// Count the writes the CODE makes to a window's scrollLeft, so "the sync does not
// write back to the window her finger is on" is an assertion rather than a hope.
// Install it AFTER setting up the position the pan starts from, so what is counted
// is only what the code does with it.
function watchWrites(node) {
  let v = node.scrollLeft;
  let writes = 0;
  Object.defineProperty(node, "scrollLeft", {
    get() { return v; },
    set(x) { v = x; writes += 1; },
    configurable: true,
  });
  return () => writes;
}
const tipOf = (row) => walk(row).find((n) => hasClass(n, "tl-tip"));
// The direct children of an element, elements only.
const kidElements = (n) => (n.children || []).filter((c) => c.nodeType === 1);
// What a node says with every tip inside it left out — the reading she gets
// without pointing at anything, which on a phone is the only reading there is.
function textWithoutTips(n) {
  if (n.nodeType === 1 && hasClass(n, "tl-tip")) return "";
  let s = n.textContent || "";
  for (const c of n.children || []) {
    if (c.nodeType === 3) s += ` ${c.text}`;
    else if (c.nodeType === 1) s += ` ${textWithoutTips(c)}`;
  }
  return s;
}
// The day where two of a person's jobs collide: the oven and the packing both on
// person 2, both starting at the same minute. Nothing stored is touched — this is
// a scenario built for the test and handed to the screen.
function collidingDay() {
  return ONE_BAKER_SCENARIO.modules.map((m) => (m.id === "solo_pack"
    ? { ...m, person: 2, startMin: 250 }
    : m.id === "solo_oven" ? { ...m, person: 2 } : { ...m }));
}
// A day where one person has a single module's work and nothing else, so their row
// is four short stretches and then empty ground the rest of the way down. Handed to
// the screen as a scenario of its own; nothing she has saved is touched.
function oneJobDay() {
  return ONE_BAKER_SCENARIO.modules.map((m) => (
    m.id === "solo_mix" ? { ...m, person: 1 } : { ...m, person: 2 }
  ));
}

test("a person's row is their name and nothing else, and their tip carries the rest (v158)", () => {
  const { root } = render();
  const rows = personRows(root);
  assert.ok(rows.length, "the day has no person rows at all");

  for (const row of rows) {
    const cell = nameCell(row);
    assert.ok(cell, "a person row has no name cell");
    // Nothing under the name outside the tip: the work total, the places and the
    // red collision line used to be printed here, on the row, and they are what
    // made the row taller than the bars beside it.
    const loose = walk(cell).filter((n) => hasClass(n, "tl-sub") && !walk(tipOf(row)).includes(n));
    assert.equal(loose.length, 0,
      `a person row still prints ${loose.length} line(s) of its own: ${loose.map((n) => textOf(n).trim()).join(" / ")}`);
    const own = textWithoutTips(cell);
    assert.doesNotMatch(own, /of work/, "the work total is still on the row itself");
    assert.doesNotMatch(own, /collisions|two jobs at once/, "the collision line is still on the row itself");

    // And all of it is in the tip, which is what a computer points at.
    const tip = tipOf(row);
    assert.ok(tip, "the person's row carries no tip, so their notes went nowhere");
    assert.match(textOf(tip), /of work/, "the tip does not carry the work total");
    assert.match(textOf(tip), /What they do today/, "the tip does not carry the jobs");
  }
});

test("a person's tip and their card say the same things, word for word (v158)", () => {
  const { root } = render();
  for (const row of personRows(root)) {
    const tip = tipOf(row);
    const workLine = walk(tip).find((n) => hasClass(n, "tl-sub") && /of work/.test(textOf(n)));
    assert.ok(workLine, "the tip carries no work total at all");
    const work = textOf(workLine).split(" · ")[0].replace(/\s+/g, " ").trim();
    // Every job line the tip carries, in the tip's own order — read off the same
    // list the card prints, with the same cap of six and the same "…and N more".
    const jobs = walk(tip).filter((n) => hasClass(n, "tl-note-job"))
      .map((n) => textOf(n).replace(/\s+/g, " ").trim());

    row.dispatchEvent({ type: "click" });
    const body = popupBody();
    assert.ok(body.includes(work), `the tip says "${work}" and the card does not`);
    assert.ok(jobs.length, "the tip carries no job lines at all");
    let from = 0;
    for (const job of jobs) {
      const at = body.indexOf(job, from);
      assert.ok(at >= 0, `the card does not carry the tip's job line "${job}"`);
      from = at + job.length;
    }
  }
});

test("a collision changes nothing about a row's shape, so the strip's height is fixed (v158)", () => {
  const { root } = render({ modules: collidingDay() });
  const rows = personRows(root);
  // The shape of a name cell, by what each part is for rather than by its exact
  // class list — a person's tip wears one class more than a module's, and the
  // question here is which parts are in the cell, not what they are painted with.
  const shape = (row) => kidElements(nameCell(row)).map((c) => (hasClass(c, "tl-tip") ? "tip"
    : hasClass(c, "tl-name-top") ? "name" : String(c.className))).join(" + ");

  const clashing = rows.find((r) => /collisions|two jobs at once/.test(textOf(tipOf(r))));
  const clean = rows.find((r) => !/collisions|two jobs at once/.test(textOf(tipOf(r))));
  assert.ok(clashing, "no person on this day has a collision, so the comparison proves nothing");
  assert.ok(clean, "every person on this day has a collision, so there is no clean row to compare with");

  assert.equal(shape(clashing), shape(clean),
    "a collision still adds a line to its own row, so the foot of the panel moves under her");

  // And a person's row is shaped exactly like a module's — the same two things in
  // the name cell — which is why it is the same height and why the height cannot
  // move. A module row carries its name and its tip; nothing else.
  const moduleRow = walk(root).find((n) => hasClass(n, "tl-row") && !hasClass(n, "person") && tipOf(n));
  assert.ok(moduleRow, "no module row carries a tip");
  assert.equal(shape(clean), shape(moduleRow),
    `a person's row is not shaped like a module's: ${shape(clean)} against ${shape(moduleRow)}`);
});

test("the tip is a sibling of the name and not inside it (v158)", () => {
  const { root } = render();
  for (const row of personRows(root)) {
    const cell = nameCell(row);
    const kids = kidElements(cell);
    assert.equal(kids.length, 2, `a person's name cell holds ${kids.length} things, not two`);
    assert.ok(hasClass(kids[0], "tl-name-top"), "the name cell does not open with the name's line");
    assert.ok(hasClass(kids[1], "tl-tip"), "the tip is not a sibling of the name's line");
    // Inside the name's own line, opening the tip would be back in the row's flow —
    // which is the growing row v156 exists to stop.
    assert.equal(walk(kids[0]).filter((n) => hasClass(n, "tl-tip")).length, 0,
      "the tip is inside the name's own line, so opening it can move the row");

    // The label is in a span of its own, without which the ellipsis can never
    // apply: a bare string in a flex row is an anonymous flex item no rule reaches.
    const label = walk(kids[0]).find((n) => hasClass(n, "tl-name-txt"));
    assert.ok(label, "the person's label is a bare string, so a long one wraps the row taller than its bars");
    assert.match(textOf(label), /Person 1/, `the label stopped naming the person: ${textOf(label)}`);
  }
});

test("a person's card is pinned to the screen, and the module's still centres (v158, v167)", () => {
  const css = read("admin/css/app.css");
  // The module tip is unchanged, and a v157 test stands on this line: it is
  // centred on its row, which is what keeps a first or last module's box inside
  // the window. Measured, all eight of them do fit.
  assert.match(css, /\.tl-tip\s*\{[^}]*top:\s*50%[^}]*translateY\(-50%\)/,
    "the module's tip stopped being centred on its row");
  // A person's card is not placed inside its window at all, because it does not fit
  // there in any direction: measured at 1280x900, the first person's card is 180 pixels
  // tall in a window of 69. So it is fixed to the screen and the view places it.
  assert.match(css, /\.tl-people\s+\.tl-tip\s*\{[^}]*position:\s*fixed/,
    "a person's card is still positioned inside a window too short to hold it");
  assert.match(css, /\.tl-people\s+\.tl-tip\s*\{[^}]*transform:\s*none/,
    "a person's card carries a transform, which would place it against its row again");
  // The width it was allowed was reserved for a card sitting inside the panel beside
  // the 156px name column. A card pinned to the screen is not beside anything, so that
  // reserve is gone and the screen's own width is what it may use.
  assert.doesNotMatch(css, /\.tl-people\s+\.tl-tip\s*\{[^}]*100vw\s*-\s*240px/,
    "a screen-pinned card is still reserving room beside the name column it left");
  // And it folds instead of widening: a job line is a module's name with a clock
  // and a line number in front of it, and that is wider than the box is allowed.
  assert.match(css, /\.tl-tip-person\s*\{[^}]*white-space:\s*normal/,
    "a job line cannot fold, so the box runs past the width it is allowed");
  // The block itself still may not clip what it holds: the card has to be able to
  // leave its own row. The clip line is the window's, and it is four edges.
  assert.doesNotMatch(css, /\.tl-people\s*\{[^}]*overflow\s*:\s*(?!visible)/,
    "the people block has an overflow of its own, which would clip the tips inside it");
  // And the hover tint on a person's row is gone, her own v156 instruction applied
  // to the last rows that had not had it: only the title opens the note.
  assert.doesNotMatch(css, /\.tl-row\.person\.tappable:hover/,
    "a person's row still reacts when the pointer is not on their title");
});

// The card is pinned to the screen, so its place is not decided by the stylesheet and
// has to be worked out where it belongs — beside the name being pointed at, and never
// off the screen. Both halves are asserted: a card placed with no clamp would hang off
// the bottom of the last person's row, which is the fault this release exists for on
// the screen it can be seen on. The numbers are a screen of 1000 by 800 (above).
test("a person's card is placed beside the name, and never off the screen (v167)", () => {
  const { root } = render();
  const rows = personRows(root);
  assert.ok(rows.length, "no person rows to place a card for");

  const room = (row, nameRect, tipRect) => {
    const cell = nameCell(row);
    cell._rect = nameRect;
    tipOf(row)._rect = tipRect;
    cell.dispatchEvent({ type: "mouseenter" });
    return { cell, tip: tipOf(row) };
  };

  // A row with room under it: the card opens beside the name column, level with the
  // row. 156px wide name at x=200, so the card starts 6px past its right edge.
  const first = room(rows[0], { left: 200, top: 100, width: 156, height: 35 },
    { left: 0, top: 0, width: 272, height: 180 });
  assert.equal(stylePx(first.tip, "left"), 362, "the card did not open beside the name");
  assert.equal(stylePx(first.tip, "top"), 100, "the card did not open level with the row");

  // The last row of a short window: there is no room under it, and 8px of screen is
  // kept under the card rather than half of it being lost off the bottom — the fault
  // that started this release, one window up.
  const last = room(rows[0], { left: 200, top: 700, width: 156, height: 35 },
    { left: 0, top: 0, width: 272, height: 180 });
  assert.equal(stylePx(last.tip, "top"), 612, "the card hangs off the bottom of the screen");
  assert.equal(stylePx(last.tip, "top") + 180, 792, "the card is not kept clear of the screen's edge");

  // And a name at the far right of a wide day: the card comes back onto the screen
  // rather than running off its right edge, which on a day 2,000 pixels wide is the
  // common case rather than the rare one.
  const right = room(rows[0], { left: 900, top: 100, width: 156, height: 35 },
    { left: 0, top: 0, width: 272, height: 180 });
  assert.equal(stylePx(right.tip, "left"), 720, "the card runs off the right of the screen");
  assert.equal(stylePx(right.tip, "left") + 272, 992, "the card is not kept clear of the screen's edge");
});

test("the PEOPLE heading is gone (v158)", () => {
  const { root } = render();
  assert.equal(walk(root).filter((n) => hasClass(n, "tl-split")).length, 0,
    "the PEOPLE heading is still drawn over the people");
  // And its rules went with it, rather than being left in the stylesheet for the
  // next reader to wonder about.
  assert.doesNotMatch(read("admin/js/views/scenario.js"), /tl-split/, "the PEOPLE heading is still built");
  assert.doesNotMatch(read("admin/css/app.css"), /\.tl-split\s*\{/,
    "the PEOPLE heading's rule is still in the stylesheet with nothing on the screen wearing it");
});

test("the ruler's step follows the scale, and reaches the minute at the closest stops (v158, v184)", () => {
  // Her ask: "make the ruler resolution to 1min" — and, asked where a minute could
  // be drawn at all, "a minute where it can be drawn". A minute is 1.2px at the
  // wide stop, so the step follows the scale: half hours across a whole day, quarter
  // hours at the standard reading, five minutes at Close, and a minute at all three
  // of the closest stops — where she is lining two bars up and the minute is the
  // thing she is looking at.
  const windowMin = computeScenario(ONE_BAKER_SCENARIO).windowMin;
  const hourCount = Math.floor(windowMin / 60) + 1;
  const minorCount = Math.max(0, Math.floor((windowMin - 30) / 60) + 1);

  for (const c of [
    { pxPerMin: 1.2, step: 30, name: "Wide" },
    { pxPerMin: 1.6, step: 15, name: "Standard" },
    { pxPerMin: 2.4, step: 5, name: "Close" },
    { pxPerMin: 3.2, step: 1, name: "Closer" },
    { pxPerMin: 4.8, step: 1, name: "Closest" },
    { pxPerMin: 7.2, step: 1, name: "Detail" },
  ]) {
    const { root } = render({ pxPerMin: c.pxPerMin });
    const ruler = walk(root).find((n) => hasClass(n, "tl-ruler"));
    assert.ok(ruler, `no ruler at ${c.name}`);
    const ticks = walk(ruler).filter((n) => hasClass(n, "tl-tick"));
    assert.equal(ticks.length, Math.floor(windowMin / c.step) + 1,
      `at ${c.name} the ruler is not drawn every ${c.step} minutes`);

    // On the hour: solid and labelled, and nothing else is labelled. The half
    // hour: the dashed tick it has always been. Anything finer: the new fine
    // hairline, which is the only thing v158 added to the ruler.
    const labelled = ticks.filter((n) => walk(n).some((x) => x.tagName === "SPAN"));
    assert.equal(labelled.length, hourCount, `at ${c.name} something other than an hour is labelled`);
    const minor = ticks.filter((n) => hasClass(n, "minor"));
    assert.equal(minor.length, minorCount, `at ${c.name} the half hour is not the dashed tick`);
    const fine = ticks.filter((n) => hasClass(n, "fine"));
    assert.equal(fine.length, ticks.length - hourCount - minorCount, `at ${c.name} the fine ticks are not the rest`);
    if (c.step < 30) assert.ok(fine.length > 0, `at ${c.name} the ruler is not drawn finer than the half hour`);
    else assert.equal(fine.length, 0, `at ${c.name} a minute is ${c.pxPerMin}px and there is no room for a finer mark`);
  }
});

test("a module drawn as lines can wait on the module above it (v155)", () => {
  // Found while building v155, and it is older than this release: a module drawn as
  // two production line read the waiting badge's words from `aboveBadge`, which was
  // declared inside the other half of an if. Two production line on a module that
  // waits on the one above — two taps on her own card — threw instead of drawing.
  // Nothing she has saved is drawn as lines, which is the only reason it is a latent
  // fault rather than a report.
  const modules = ONE_BAKER_SCENARIO.modules.map((m) => (m.id === "solo_scale" ? { ...m, count: 2, follow: true, startMode: "wait" } : { ...m }));
  const { root } = render({ modules });

  const lines = walk(root).filter((n) => hasClass(n, "tl-row") && hasClass(n, "tl-line"));
  assert.equal(lines.length, 2, "the module's two production line were not drawn");
  const first = lines.find((n) => textOf(n).includes("Oil the pans"));
  assert.ok(first, "the line rows do not name the module they belong to");
  assert.match(textOf(first), /waits above/, "the line row lost the badge saying it waits on the module above");
  // And the module is still one thing she can read in one place: its name and its
  // waiting are on the first line, never repeated on the second.
  const second = lines.find((n) => !textOf(n).includes("Oil the pans"));
  assert.ok(!/waits above/.test(textOf(second)), "the waiting badge is repeated on the second production line");
});

// ── The ruler's lines carried down to the people (v160) ───────────────────
// Her ask: "can the ruler extend down to peoples marker area?" The clock strip is
// one row at the top of the chart and the markers are rows below it, so the lines
// are painted down every track instead — and a marker's edge then lands on a line
// she can follow up to the clock. Asked which way she wanted it, she chose a faint
// grid down every row; a clock repeated above the people was the other option.
//
// The grid's step is the ruler's own wherever the ruler can be read, and a coarser
// one where it cannot: at the closest stop a minute is 3.2px, and a line every
// 3.2px is a wash of grey rather than a grid. It takes the smallest step that is
// BOTH at least the ruler's — which is what makes every grid line a tick as well,
// so the two can never disagree about where a minute is — and at least twelve
// pixels wide.
test("the ruler's lines are carried down every row, at a step that is still a grid (v160)", () => {
  // The grid is PAINTED rather than laid out — a second gradient layer on the
  // track, which is zero new nodes. That is not a detail: the ruler alone draws
  // 1441 tick elements at the closest stop, and duplicating those down eight
  // module rows and every person row would be ten thousand nodes in the panel.
  const css = read("admin/css/app.css");
  const rules = (re) => [...css.matchAll(re)].map((m) => m[0]);
  // Since v169 the ruling is the track's OWN background again — a marker is a wash
  // (--marker) laid over it rather than a solid block, so the paper's ruling reads
  // through the marker instead of being stopped by it. The layers themselves are
  // unchanged.
  const trackRules = rules(/^\.tl-track\s*\{[^}]*\}/gm);
  assert.equal(trackRules.length, 1, `expected one rule for the track, found ${trackRules.length}`);
  const ruling = trackRules.filter((r) => (r.match(/repeating-linear-gradient/g) || []).length === 2);
  assert.equal(ruling.length, 1,
    `the ruling does not carry the hour line with a grid under it: ${ruling.length} rule(s) with two layers`);
  assert.match(ruling[0], /--tick-w/, "the grid layer is not drawn at --tick-w");
  // The hour line is written first because it is the one painted on top: where the
  // two fall on the same pixel it must be the line she reads the clock by.
  assert.ok(ruling[0].indexOf("--hour-w") < ruling[0].indexOf("--tick-w"),
    "the grid is painted over the hour line rather than under it");

  // And there is only ONE ruling. A layer of its own over the bars as well would
  // draw it twice — once under the marker and once across it — and a grid that is
  // drawn twice reads darker in the gaps than across a marker.
  const overlays = rules(/\.tl-track::after\s*\{[^}]*\}/g);
  assert.ok(overlays.every((r) => !/repeating-linear-gradient/.test(r)),
    "the ruling is drawn twice: the track paints it and a layer over the bars paints it again");

  // The ruler's own track keeps the hour line alone. Its tick elements already draw
  // on top of it, so a finer layer under them would put lines between the ticks the
  // clock is read off.
  const rulerRules = rules(/\.tl-ruler \.tl-track\s*\{[^}]*\}/g);
  assert.ok(rulerRules.length, "the ruler's own track is not told apart from the rows under it");
  assert.ok(rulerRules.every((r) => !/--tick-w/.test(r)),
    "the ruler's track carries the grid under its own ticks");
  // …and it must OVERRIDE the day's ruling, not merely not ask for one. The ruling
  // belongs to .tl-track now, so a ruler rule that named no background-image would
  // leave the fine grid standing between her ticks.
  assert.ok(rulerRules.some((r) => /background-image/.test(r)),
    "the ruler's track no longer overrides the day's ruling, so a grid is drawn between the ticks she reads");

  // And a module switched off keeps both layers rather than dropping the only thing
  // its own dimmed bars are read against.
  const offRules = rules(/\.tl-row\.off \.tl-track\s*\{[^}]*\}/g);
  assert.ok(offRules.length, "there is no rule for a switched-off module's track");
  assert.ok(offRules.every((r) => !/background-image/.test(r)),
    "a switched-off module paints its own background and so drops the grid");

  // The step at each of the six stops, as the chart itself sets it — read off the
  // .tl element's own style rather than recomputed, so the test cannot agree with a
  // rule the screen does not use.
  for (const c of [
    { pxPerMin: 1.2, step: 30, gridMin: 30, tickW: 36, name: "Wide" },
    { pxPerMin: 1.6, step: 15, gridMin: 15, tickW: 24, name: "Standard" },
    { pxPerMin: 2.4, step: 5, gridMin: 5, tickW: 12, name: "Close" },
    { pxPerMin: 3.2, step: 1, gridMin: 5, tickW: 16, name: "Closer" },
    { pxPerMin: 4.8, step: 1, gridMin: 5, tickW: 24, name: "Closest" },
    { pxPerMin: 7.2, step: 1, gridMin: 5, tickW: 36, name: "Detail" },
  ]) {
    const { root } = render({ pxPerMin: c.pxPerMin });
    // Read off the WRAP since v167: the two windows share one ruling, so the two
    // numbers are set once on the element both inherit from. Read from the element
    // the chart itself wrote them to rather than recomputed, so the test cannot
    // agree with a rule the screen does not use.
    const tl = walk(root).find((n) => hasClass(n, "tl-wrap"));
    assert.ok(tl, `no chart at ${c.name}`);
    assert.equal(px(tl, "--hour-w"), Math.round(60 * c.pxPerMin), `at ${c.name} the hour line moved`);
    assert.equal(px(tl, "--tick-w"), c.tickW,
      `at ${c.name} the grid is not every ${c.gridMin} minutes (${c.gridMin * c.pxPerMin}px)`);
    // Never a line she cannot tell from its neighbour — which is the whole reason
    // the grid has a step of its own and does not simply follow the ruler.
    assert.ok(c.gridMin * c.pxPerMin >= 12,
      `at ${c.name} the grid is ${c.gridMin * c.pxPerMin}px apart, which reads as a wash`);
    // And never a step that lands between the ruler's own ticks: a grid line that
    // is not also a tick is a second opinion about where a minute is.
    assert.equal(c.gridMin % c.step, 0,
      `at ${c.name} a grid line every ${c.gridMin} min is not on the ruler's ${c.step} min ticks`);
  }
});

// ── The scale at the back, the marker over it (v169) ────────────────────
//
// The same reading she has asked for since v165 — the clock she reads must hold
// INSIDE a marker, not only beside it — reached the other way round. v165 painted
// the ruling as a layer of its own over the bars and v166 had to strengthen its
// ink; at v169 she named the arrangement she wants instead: "its scale should be
// at background, the marker should be ontop, with some degree of transparency".
//
// So the ruling is the track's own background again and every marker is a wash
// (--marker) over it. The one thing that must NOT come back is the layer over the
// bars: a grid drawn both under a marker and across it reads darker in the gaps
// than across the marker, and the eye reads that as two different grids.
test("the marker is a wash over the ruling, not a block that stops it (v169)", () => {
  const css = read("admin/css/app.css");
  const rules = (re) => [...css.matchAll(re)].map((m) => m[0]);

  // One ruling, and it is the track's own background — the one the bars are drawn on.
  const rulings = rules(/^\.tl-track\s*\{[^}]*\}/gm)
    .filter((r) => /repeating-linear-gradient/.test(r));
  assert.equal(rulings.length, 1, `expected the ruling on the track's own background, found ${rulings.length}`);
  const overlays = rules(/\.tl-track::after\s*\{[^}]*\}/g)
    .filter((r) => /repeating-linear-gradient/.test(r));
  assert.equal(overlays.length, 0,
    "the ruling is drawn over the markers as well, so it is drawn twice and reads darker in the gaps");

  // The transparency is ONE number, on the element both windows inherit from, so
  // "a bit more" or "a bit less" is one edit and the two windows cannot drift apart.
  const wrap = rules(/^\.tl-wrap\s*\{[^}]*\}/gm);
  assert.equal(wrap.length, 1, `expected one rule for the chart's wrap, found ${wrap.length}`);
  const mk = wrap[0].match(/--marker:\s*([\d.]+)/);
  assert.ok(mk, "the marker's transparency is not declared on the wrap, so nothing can be tuned in one place");
  const marker = Number(mk[1]);
  assert.ok(marker > 0.3 && marker < 1,
    `--marker is ${marker}: a marker that faded to nothing is not a marker, and ${marker >= 1 ? "one at 1 is not transparent at all" : "one this faint hides the day"}`);
  // Counted with the comments stripped: the stylesheet explains this number in
  // prose in two places, and a mention is not a declaration.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal((bare.match(/--marker:/g) || []).length, 1,
    "the marker's transparency is declared in more than one place, so the two windows can disagree");

  // Both families of marker go through it — the eight module tones (a batch bar)
  // and the eight person tones (a person's time slot), because they are the SAME
  // element and a change to one that misses the other is exactly how a batch and a
  // slot stop looking alike.
  const washes = [
    ...rules(/\.tone-\d\s*\{[^}]*\}/g),
    ...rules(/\.tl-row\.person \.tl-bar\.ptone-\d\s*\{[^}]*\}/g),
  ];
  assert.equal(washes.length, 16, `expected 16 marker tones, found ${washes.length}`);
  for (const w of washes) {
    const name = w.split("{")[0].trim();
    assert.match(w, /background:\s*rgba\([^)]*var\(--marker/,
      `${name} is not a wash at --marker, so the ruling cannot read through it`);
    assert.ok(!/background:\s*#/.test(w), `${name} is still painted as an opaque block`);
  }

  // And nothing the chart draws is left opaque in its place: a solid marker is what
  // hid the ruling in the first place.
  const barRules = rules(/\.tl-bar\s*\{[^}]*\}/g);
  assert.ok(barRules.length, "there is no rule for a bar at all");
  assert.ok(barRules.every((r) => !/background:\s*#/.test(r)),
    "a bar is given an opaque background of its own, over the wash its tone sets");
});

// ── A frame on every marker (v169), drawn quietly (v170) ────────────────
//
// Her ask: "can the batch and person time slot having a more highligted frame?".
// A batch bar and a person's time slot are the same element, so one rule frames
// both — and it is drawn as a layer rather than a border, because a border would
// eat into the box the cycle shades and her hands are placed in, and an inset
// shadow on the bar itself would be painted over by those shades. The frame is the
// module's or the person's SOLID tone, the same colour her hands already wear.
//
// Then, after living with it, her report: "the border look like over emphasized".
// v169 drew a 1.5px line at full strength — a box round every pale bar. It is 1px
// now, and the layer is laid down at --frame, so the frame still states which module
// a bar belongs to without shouting it. Her words are pinned in both the stylesheet
// and here, and v170's probe puts the shout back to watch this test name it.
test("a batch bar and a person's time slot both wear a frame in their own tone (v169, softened v170)", () => {
  const css = read("admin/css/app.css");
  const rules = (re) => [...css.matchAll(re)].map((m) => m[0]);

  // One frame rule, and it frames the marker itself.
  const frame = rules(/\.tl-bar::after\s*\{[^}]*\}/g);
  assert.equal(frame.length, 1, `expected one frame rule, found ${frame.length}`);
  assert.match(frame[0], /inset:\s*0/, "the frame does not follow the marker's own box");
  assert.match(frame[0], /border-radius:\s*inherit/,
    "the frame is square-cornered on a rounded marker");
  assert.match(frame[0], /box-shadow:\s*inset[^;]*var\(--tone-ink/,
    "the frame is not drawn in the marker's own tone");
  assert.match(frame[0], /pointer-events:\s*none/,
    "the frame would swallow the tap that opens the batch or the stretch");

  // And it is a quiet edge rather than a shouted box — her report of 23 September
  // 2026, after living with v169 for a day: "the border look like over emphasized".
  // Both numbers are pinned, so a later edit cannot quietly put the shout back.
  assert.match(frame[0], /box-shadow:\s*inset[^;]*0 0 0 1px\b/,
    "the frame is no longer a 1px line");
  assert.ok(!/1\.5px/.test(frame[0]),
    "the frame is back to v169's 1.5px line, which she reported as over emphasized");
  assert.match(frame[0], /opacity:\s*var\(--frame/,
    "the frame is laid down at full strength, so its softness cannot be tuned in one place");

  // One number softens every frame in both windows, declared on the element they
  // both inherit from — beside --marker, for the same reason.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal((bare.match(/--frame:/g) || []).length, 1,
    "the frame's strength is declared in more than one place, so the two windows can disagree");
  const wrap = rules(/^\.tl-wrap\s*\{[^}]*\}/gm);
  assert.equal(wrap.length, 1, `expected one rule for the chart's wrap, found ${wrap.length}`);
  const fv = wrap[0].match(/--frame:\s*([\d.]+)/);
  assert.ok(fv, "the frame's strength is not declared on the wrap, so nothing can be tuned in one place");
  const frameStrength = Number(fv[1]);
  assert.ok(frameStrength > 0 && frameStrength < 1,
    `--frame is ${frameStrength}: ${frameStrength <= 0 ? "a frame faded to nothing is not a frame" : "one at 1 is v169's shout back again"}`);

  // A border would shrink the padding box the cycles and her hands are placed in,
  // and an inset shadow on the bar itself would be painted over by the cycle shades;
  // the frame must be neither. Every rule that styles a marker's own box, of which
  // there are three (a batch's, a person's, and the pointer the two share), is asked.
  const barRules = rules(/\.tl-bar\s*\{[^}]*\}/g);
  assert.ok(barRules.length >= 3, `expected the marker's own box rules, found ${barRules.length}`);
  for (const r of barRules) {
    assert.ok(!/border\s*:/.test(r), `a frame is drawn as a border, which moves the marker's insides: ${r.split("{")[0].trim()}`);
    assert.ok(!/box-shadow/.test(r), `a frame is drawn as an inset shadow on the bar, which the cycle shades paint over: ${r.split("{")[0].trim()}`);
    assert.ok(!/box-sizing/.test(r), `a marker's box was re-sized to make room for a frame: ${r.split("{")[0].trim()}`);
  }
  // And the two heights are untouched, so how much of the day fits is what it was.
  assert.ok(barRules.some((r) => /height:\s*16px/.test(r)), "a batch bar is no longer 16px tall");
  assert.ok(barRules.some((r) => /height:\s*11px/.test(r)), "a person's slot is no longer 11px tall");

  // Every tone names its own ink, and the ink is the colour her hands already wear
  // inside that bar — one colour declared twice per module would be two lists to
  // keep in step, which is how a frame and its hands drift apart.
  for (let i = 0; i < 8; i += 1) {
    const tone = rules(new RegExp(`\\.tone-${i}\\s*\\{[^}]*\\}`, "g"));
    assert.equal(tone.length, 1, `expected one rule for .tone-${i}, found ${tone.length}`);
    const ink = tone[0].match(/--tone-ink:\s*(#[0-9a-f]{6})/i);
    assert.ok(ink, `.tone-${i} names no ink, so its marker has no frame`);
    const touch = rules(new RegExp(`\\.tone-${i} \\.tl-touch\\s*\\{[^}]*\\}`, "g"));
    assert.equal(touch.length, 1, `expected one rule for .tone-${i}'s hands`);
    assert.match(touch[0], new RegExp(`background:\\s*${ink[1]}`, "i"),
      `.tone-${i}'s frame is ${ink[1]} and its hands are another colour`);
  }
  // A person's slot wears their own colour, and it is the one their card already
  // carries — so the slot, its frame and the card are one person's colour.
  for (let i = 1; i <= 8; i += 1) {
    const slot = rules(new RegExp(`\\.tl-row\\.person \\.tl-bar\\.ptone-${i}\\s*\\{[^}]*\\}`, "g"));
    assert.equal(slot.length, 1, `expected one rule for .ptone-${i}, found ${slot.length}`);
    const ink = slot[0].match(/--tone-ink:\s*(#[0-9a-f]{6})/i);
    assert.ok(ink, `.ptone-${i} names no ink, so a person's slot has no frame`);
    const card = rules(new RegExp(`\\.tl-call\\.ptone-${i}\\s*\\{[^}]*\\}`, "g"));
    assert.equal(card.length, 1, `expected one rule for .tl-call.ptone-${i}`);
    assert.match(card[0], new RegExp(`border-left-color:\\s*${ink[1]}`, "i"),
      `.ptone-${i}'s frame is ${ink[1]} and that person's card is another colour`);
  }

  // And both kinds of marker are actually drawn on her day, each wearing the class
  // its ink comes from — a frame nobody is given is a frame nobody can see.
  const { root } = render();
  const bars = walk(root).filter((n) => hasClass(n, "tl-bar"));
  assert.ok(bars.length, "the chart draws no markers at all");
  const slots = personRows(root).flatMap((r) => walk(r).filter((n) => hasClass(n, "tl-bar")));
  const slotSet = new Set(slots);
  const batches = bars.filter((n) => !slotSet.has(n));
  assert.ok(slots.length, "the chart draws no person's time slots");
  assert.ok(batches.length, "the chart draws no batch bars");
  for (const b of bars) {
    assert.match(String(b.className), /tone-\d/,
      "a marker is drawn without a tone, so it has no ink to frame it in");
  }
});

// ── And the ruling is still strong enough to be read through a marker (v169) ──
//
// v166's lesson, kept and turned round: a line that is drawn and cannot be seen is
// the same as no line, which is why she came back twice. Moving the ruling behind
// the markers costs it (1 - --marker) of its strength, so the lines are drawn
// heavier than they were to pay for it — and this test is the arithmetic that says
// by how much, measured rather than trusted.
test("the ruling is strong enough to be read through a marker (v169)", () => {
  const css = read("admin/css/app.css");
  const rules = (re) => [...css.matchAll(re)].map((m) => m[0]);
  const ruling = rules(/^\.tl-track\s*\{[^}]*\}/gm)
    .filter((r) => /repeating-linear-gradient/.test(r));
  assert.equal(ruling.length, 1, `expected one ruling rule, found ${ruling.length}`);

  // Every gradient layer must state its own colour AND its alpha. A bare colour,
  // or a color-mix, is what made the last one unmeasurable — and color-mix is also
  // the one form an older phone browser can fail to parse, which would drop the
  // whole background-image and take the ruling with it.
  const layers = [...ruling[0].matchAll(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/g)]
    .map((m) => Number(m[1]));
  assert.equal(layers.length, 2,
    `expected both ruling layers in a plain rgba colour, found ${layers.length}`);
  assert.ok(!/color-mix/.test(ruling[0]),
    "the ruling is written with color-mix, which an older phone browser can drop");

  const marker = Number(rules(/^\.tl-wrap\s*\{[^}]*\}/gm)[0].match(/--marker:\s*([\d.]+)/)[1]);
  const P = [255, 253, 249];   // --surface: the paper the day is ruled on
  const INK = [122, 96, 74];
  for (const a of layers) {
    // Seen THROUGH a marker: the same wash over the line and over the bare paper,
    // so the marker's own colour cancels out and what is left of the line is
    // (1 - marker) of its own contrast against the paper. This is the whole cost of
    // putting the ruling at the back, and the reason both alphas are higher than
    // v166's .34 and .20.
    const d = Math.max(...INK.map((c, i) => (1 - marker) * a * Math.abs(c - P[i])));
    assert.ok(d >= 20,
      `a ruling line at alpha ${a} under a marker at ${marker} differs from the marker beside it by only ${d.toFixed(1)} parts in 255, which is invisible on a phone — the fault she reported twice at v165 and v166`);
  }

  // The hour line still leads the grid: it is the line a marker is traced up to
  // the clock with, so it must not be the fainter of the two.
  assert.ok(Math.max(...layers) > Math.min(...layers),
    "the hour line and the grid are the same strength, so neither leads the eye");

  // And no line may cross a label. Both labels are lifted above the one thing a
  // marker draws across itself — its own frame — so thickening the frame cannot put
  // a line through a B-number or a person's name.
  const frame = rules(/\.tl-bar::after\s*\{[^}]*\}/g);
  assert.equal(frame.length, 1, `expected one frame rule, found ${frame.length}`);
  const fz = frame[0].match(/z-index:\s*(-?\d+)/);
  assert.ok(fz, "the frame has no z-index, so it cannot be known to be under the labels");
  for (const fsel of [".tl-btag", ".tl-pname"]) {
    const rule = rules(new RegExp(`\\${fsel}\\s*\\{[^}]*\\}`, "g"));
    assert.equal(rule.length, 1, `expected one rule for ${fsel}, found ${rule.length}`);
    const z = rule[0].match(/z-index:\s*(-?\d+)/);
    assert.ok(z, `${fsel} has no z-index, so the marker's frame is drawn through the label`);
    assert.ok(Number(z[1]) > Number(fz[1]),
      `${fsel} sits at z-index ${z[1]} and the frame at ${fz[1]}, so the frame is drawn through the label`);
  }
});

// ── Panning right may not put the day's writing over the module titles (v174) ──
//
// Her words, 23 September 2026: "the windows when panning right, some of the chart
// writing shown in between module titles". Measured live on her own day at a phone's
// width, with the day panned 25px: nine B-numbers and six bands of her hands were the
// topmost thing at their own position INSIDE the 156px title column — because the
// name cell was pinned at z-index 2 and every one of those was drawn at 2 or above it,
// and a tie is decided by which came later in the document. The title cell is the one
// thing on this chart that is not part of the day, so it has to outrank all of it, and
// the ladder is declared once on the wrap so the two windows cannot be tuned apart.
test("no writing from the day climbs over the module titles when the chart is panned (v174)", () => {
  const css = read("admin/css/app.css");
  const rules = (re) => [...css.matchAll(re)].map((m) => m[0]);
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // One rung each, declared once, on the element both windows inherit from.
  for (const v of ["--name-z", "--ruler-z", "--read-z"]) {
    assert.equal((bare.match(new RegExp(`${v}:`, "g")) || []).length, 1,
      `${v} is declared in more than one place, so the two windows can disagree`);
  }
  const wrap = rules(/^\.tl-wrap\s*\{[^}]*\}/gm);
  assert.equal(wrap.length, 1, `expected one rule for the chart's wrap, found ${wrap.length}`);
  const rung = (v) => {
    const m = wrap[0].match(new RegExp(`${v}:\\s*([\\d.]+)`));
    assert.ok(m, `${v} is not declared on the wrap, so nothing can be tuned in one place`);
    return Number(m[1]);
  };
  const nameZ = rung("--name-z");
  const rulerZ = rung("--ruler-z");
  const readZ = rung("--read-z");
  assert.ok(nameZ < rulerZ, `the titles sit at ${nameZ} and the clock strip at ${rulerZ}, so the strip is scrolled under the titles`);
  assert.ok(rulerZ < readZ, `the clock strip sits at ${rulerZ} and the readings at ${readZ}, so a reading lands on the strip and is buried by it`);

  // The rules whose selector names one class and nothing else — `.tl-btag`, not
  // `.tl-btag.nudged` and not `.tl-tip-person`, both of which are the same box in
  // another state or another size rather than a second box with its own rung.
  const bareBlocks = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const own = (cls) => bareBlocks.filter((b) => new RegExp(`^\\.${cls}$`).test(b.sel) || new RegExp(`[\s>+~]\\.${cls}$`).test(b.sel));

  // The three things that stand on a rung name it, rather than repeating the number.
  for (const [cls, v] of [["tl-name", "--name-z"], ["tl-ruler", "--ruler-z"]]) {
    const mine = own(cls).filter((b) => /z-index/.test(b.body));
    assert.equal(mine.length, 1, `expected one rule carrying ${cls}'s z-index, found ${mine.length}`);
    assert.match(mine[0].body, new RegExp(`z-index:\\s*var\\(${v}`),
      `.${cls} does not stand on ${v}, so the rungs it belongs to cannot be moved in one place`);
  }
  for (const cls of ["tl-cursor-lab", "tl-now"]) {
    const mine = own(cls).filter((b) => /z-index/.test(b.body));
    assert.equal(mine.length, 1, `expected one rule carrying ${cls}'s z-index, found ${mine.length}`);
    assert.match(mine[0].body, /z-index:\s*var\(--read-z/,
      `.${cls} does not stand on --read-z, so a reading can be buried by the bar it is read against`);
  }

  // And everything the DAY draws — its marks on her bars, the numbers and names on
  // them, and a module's own note — is strictly under the titles, so no pan position
  // can bring one of them up over a title. A tie is not enough: at equal z-index the
  // later element in the document wins, and every one of these is drawn after the
  // name cell.
  for (const sel of [".tl-tip", ".tl-bar::after", ".tl-touch", ".tl-btag", ".tl-pname"]) {
    const mine = bareBlocks.filter((b) => b.sel === sel);
    assert.equal(mine.length, 1, `expected one rule for ${sel}, found ${mine.length}`);
    const z = mine[0].body.match(/z-index:\s*(-?\d+)/);
    assert.ok(z, `${sel} has no z-index, so it is a tie with the titles and wins on document order`);
    assert.ok(Number(z[1]) < nameZ,
      `${sel} is drawn at z-index ${z[1]} and the titles at ${nameZ}, so panning right puts the day's writing between the module titles — her report of 23 September 2026`);
  }

  // And the reading itself is refused where the day is not in front of her. The ruler's
  // own track scrolls with the day, so once she has panned, the day's left edge has
  // travelled off behind the titles and `clientX - track.left` stays positive over the
  // title column as well — enough to place a hairline and a number on top of a name.
  const { root } = render();
  const proc = paneOf(root, "proc");
  const track = walk(walk(proc).find((n) => hasClass(n, "tl-ruler"))).find((n) => hasClass(n, "tl-track"));
  const cursor = walk(proc).find((n) => hasClass(n, "tl-cursor"));
  const lab = walk(proc).find((n) => hasClass(n, "tl-cursor-lab"));
  // The day panned 25px: the titles still begin at the pane's own left edge, and the
  // track — which scrolls — now starts at 156 - 25 = 131, so its own edge no longer
  // says where the titles end. The track's own box is given at its unscrolled place
  // now that the stand-in screen subtracts its ancestors' scroll the way the window
  // does; before that this test had to write 131 in by hand, which is the same
  // arithmetic done twice and only one of the two could be wrong.
  proc.scrollLeft = 25;
  track._rect = { left: 156, top: 0, width: 2400, height: 20 };
  const press = (clientX) => track.dispatchEvent({ type: "pointerdown", clientX, clientY: 8, pointerId: 71 });

  press(140);   // 140 of the titles' 156, though 9px past the track's own edge
  assert.equal(cursor.hidden, true,
    "a reading was taken with the pointer over the module titles, so the hairline is drawn across them");
  assert.equal(lab.hidden, true,
    "a clock was read out with the pointer over the module titles, so the number is written over a module's name");

  press(200);   // past the titles, on the day itself
  assert.equal(cursor.hidden, false, "a reading on the day itself was refused, so the cursor is gone from the chart");
  assert.ok(lab.textContent, "the minute on the day itself was not read out");
});

// ── The clock, drawn once (v162 reverted) ────────────────────────────────
// v162 drew the clock a second time directly above the people's rows, at her own
// ask — "yes, draw the clock above the people's rows". Read on the screen, she did
// not want it: "i dont want the clock, i just want the ruler to draw into person
// row". And the ruler's LINES do reach her people's rows already — that is the
// v160 grid, whose test stands above — so the second clock was answering an ask
// that had been answered with the grid.
//
// So the clock is one row again, at the top of the panel, which is where it has
// always been. Kept as a test rather than left to the diff, because the second
// clock is a thing that could be re-added by accident: it came from a shared
// builder, so giving rulerRow a second call site is one line.
test("the clock is drawn once, at the top of the chart", () => {
  const { root } = render();
  const clocks = walk(root).filter((n) => hasClass(n, "tl-ruler") || hasClass(n, "tl-ruler-foot"));
  assert.equal(clocks.length, 1, `${clocks.length} clock rows are drawn on the chart, not one`);
  assert.ok(hasClass(clocks[0], "tl-ruler"), "the clock row is not the ruler at the top of the panel");
  assert.equal(walk(root).filter((n) => hasClass(n, "tl-ruler-foot")).length, 0,
    "a clock is drawn above the people's rows again");
  assert.equal(read("admin/css/app.css").indexOf("tl-ruler-foot"), -1,
    "the stylesheet still carries rules for a clock above the people's rows");
  // And it is still pinned where it has always been, wearing the class that pins it.
  assert.match(read("admin/css/app.css"), /\.tl-ruler\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/,
    "the clock is no longer pinned to the top of the panel");

  // The drag still belongs to it, and to nothing else: one strip, one handler.
  const trackOf = (row) => walk(row).find((n) => hasClass(n, "tl-track"));
  const band = trackOf(clocks[0]);
  assert.ok(band, "the clock row has no track to read along");
  assert.ok((band._listeners.pointerdown || []).length, "the clock strip cannot be dragged");
  assert.ok((band._listeners.pointermove || []).length, "the clock strip does not follow a drag");
  const cursor = walk(root).find((n) => hasClass(n, "tl-cursor"));
  const lab = walk(root).find((n) => hasClass(n, "tl-cursor-lab"));
  assert.ok(cursor && lab, "the chart draws no time cursor to read against");
  band.dispatchEvent({ type: "pointerdown", clientX: 400, clientY: 100, pointerId: 1 });
  const at = lab.textContent;
  band.dispatchEvent({ type: "pointerup", clientX: 400, clientY: 100, pointerId: 1 });
  assert.ok(!cursor.hidden && at, "a drag along the clock reads nothing at all");

  // And the hairline reaches the people's window from that one reading — her own
  // ask, arriving at the same place from the other side: "instead of consider then
  // one window, why not create 2 windows, and let the ruler sync in the 2
  // windows". The LINE travels; the READING stays in the window the finger is in,
  // because its height comes from where the pointer is, which is nothing to do with
  // a window the pointer is not over.
  const cursors = walk(root).filter((n) => hasClass(n, "tl-cursor"));
  assert.equal(cursors.length, 2, `${cursors.length} hairlines are drawn, not one per window`);
  const proc = paneOf(root, "proc");
  const people = paneOf(root, "people");
  assert.equal(walk(proc).filter((n) => hasClass(n, "tl-cursor")).length, 1, "the modules' window has no hairline");
  assert.equal(walk(people).filter((n) => hasClass(n, "tl-cursor")).length, 1, "the people's window has no hairline of its own");
  assert.ok(cursors.every((n) => !n.hidden), "a hairline is left hidden while the other reads a minute");
  assert.equal(stylePx(cursors[0], "left"), stylePx(cursors[1], "left"),
    "the two windows are reading different minutes off one drag");
  assert.equal(walk(root).filter((n) => hasClass(n, "tl-cursor-lab")).length, 1,
    "the reading is drawn in both windows, so it names a minute at a height that means nothing in one of them");
  assert.ok(walk(proc).includes(lab), "the reading left the window it was taken in");
});

// ── Handing one stretch of somebody's day to somebody else (v160, v161) ──
// Her ask: "can the personX marker be click to change it job to personY, by a drop
// down person selector" — and then, asked which gesture she meant, "click on the
// person's occupied time slot, a drop down list, list the other people available".
//
// And her correction of the day after, once v160 shipped the move at module level:
// "The reassign job to next person is not whole day, it is that slot only" — then,
// asked what one tap should take with it, "we dont change the batch. Say a labour
// slot belongs to person1, clicking that slot, will offer to swap it to others,
// this basically to balance work load". So what changes hands is the ONE stretch
// under her finger. A fold loop that folds three times in a batch draws three
// markers, and handing one over leaves the other two where they are.
//
// The stretch is found by the MINUTE under the finger and not by closest(".tl-bar"),
// which is what the module rows do: a person's marker carries no dataset at all, so
// a bar could not say which module it came off. Reading the minute also gives her
// the row's whole height instead of the 11px sliver a bar is.

// A fold loop on person 1 and a mix on person 2: two rows, and a batch of the fold
// that draws three separate stretches of hands. Every fold is six minutes rather
// than the one her own rest really takes, so the finger can land well inside a
// stretch instead of beside it — a one-minute marker is 1.6 pixels wide.
function foldDay() {
  return [
    { id: "fold", name: "The fold loop", on: true, person: 1, people: 1,
      cycles: [
        { name: "Rest, then fold one", min: 31, load: 0, unload: 6 },
        { name: "Rest, then fold two", min: 31, load: 0, unload: 6 },
        { name: "Rest, then fold three", min: 31, load: 0, unload: 6 },
      ],
      batch: 6, everyMin: 300, repeats: 2, startMin: 0 },
    { id: "mix", name: "Mixing the dough", on: true, person: 2, people: 1,
      cycleMin: 20, batch: 6, touchMin: 20, everyMin: 20, repeats: 1, startMin: 0 },
  ];
}

// A tap on a person's track at the pixel `x` along the day. The view reads the
// minute under the finger, so the test states a position and not a bar — and the
// shim's own rects start at zero, so `x` is the day's own offset. Returns whether
// the tap was swallowed, because what happens to an unswallowed one is that the
// row underneath opens the person's own card.
function tapSlot(track, x) {
  let stopped = false;
  track.dispatchEvent({ type: "click", clientX: x, target: track, stopPropagation() { stopped = true; } });
  return stopped;
}
// The track of the person row wearing the tone class `tone`, so a row is found by
// who it is rather than by a name that may also read out of a module above it.
function personTrack(root, tone) {
  const row = personRows(root).find((n) => hasClass(n, tone));
  assert.ok(row, `the day has no ${tone} person row`);
  const track = walk(row).find((n) => hasClass(n, "tl-track"));
  assert.ok(track, `the ${tone} person row has no track`);
  return track;
}
const barsOf = (track) => walk(track).filter((n) => hasClass(n, "tl-bar"));
// Every person row as the tone it wears and the job titles it carries, which is how
// a move is read back: the marker that was on one row is on the other. A row for a
// person who has been left with nothing is not here at all, which is itself one of
// the answers.
function rowsByTone(root) {
  return personRows(root).map((n) => ({
    tone: (String(n.className).match(/ptone-\d+/) || [""])[0],
    titles: barsOf(walk(n).find((x) => hasClass(x, "tl-track"))).map((b) => String(b.attrs.title)),
  }));
}
const titlesOf = (root, tone) => (rowsByTone(root).find((r) => r.tone === tone) || { titles: [] }).titles;

test("a tap on a person's occupied stretch hands that one stretch over, and nothing beside it (v161)", () => {
  const { root, state } = render({ modules: foldDay() });
  const track = personTrack(root, "ptone-1");
  const bars = barsOf(track);
  assert.equal(bars.length, 6, "the fold day does not draw three stretches for each of its two batches");

  // The SECOND fold of the first batch — the middle one of the three, so a hand-over
  // that took the whole batch with it would show on both sides of this tap. The three
  // are told apart by the clock they carry, which is what the marker says and what
  // the card repeats; the module's name is on all three of them, as it should be.
  const first = bars.slice(0, 3).map((b) => String(b.attrs.title || ""));
  assert.equal(new Set(first).size, 3, `the three folds of one batch are not three markers: ${first.join(" | ")}`);
  const bar = bars[1];
  const job = first[1];
  const x = px(bar, "left") + px(bar, "width") / 2;
  assert.equal(tapSlot(track, x), true,
    "a tap on a stretch of the day was let through to the person's own card");

  // The card names the one stretch it is about, in the same words the marker's own
  // title carries — so there is no doubt which of the three she tapped.
  assert.match(popupTitle(), /Move this slot off Person 1/, `the tap opened "${popupTitle()}"`);
  assert.ok(popupBody().includes(job), `the card is not about "${job}": ${popupBody().slice(0, 180)}`);
  // And it says out loud, with the count, that the two folds beside this one stay
  // put — rather than letting her find that out from the chart afterwards.
  assert.match(popupBody(), /3 stretches on Person 1's row/,
    `the card does not count the batch's other stretches: ${popupBody().slice(0, 260)}`);

  // What it offers is the other people on this day, plus the day's own arrangement.
  // A person with no row is not standing anywhere on the chart, so listing them
  // would be offering an answer the day cannot give — but "whoever is free" is not a
  // person, it is what the day does when nobody is named, and it is the only way a
  // stretch can be handed back to nobody in particular.
  const picker = walk(layers["popup-layer"]).find((n) => n.tagName === "SELECT");
  assert.ok(picker, "the card offers no list of people to hand the stretch to");
  const options = walk(picker).filter((n) => n.tagName === "OPTION");
  assert.deepEqual(options.map((o) => String(o.value)), ["0", "2"],
    "the list is not the other people on this day");
  assert.match(textOf(options[0]), /Whoever is free/, "the way back to the day's own arrangement is not offered");
  assert.match(textOf(options[1]), /Person 2/, "an unnamed person is not named by their number");
  const press = popupButton(/Move it to/);
  assert.ok(press, "the card offers no press to make the move");
  assert.match(textOf(press), /Person 2/, "the press does not say who it will hand the stretch to");

  // The move. One stretch of her day changes hands and nothing else does.
  press.dispatchEvent({ type: "click" });
  assert.match(lastToast(), /handed to Person 2/, `the press said "${lastToast()}"`);
  const one = titlesOf(root, "ptone-1");
  const two = titlesOf(root, "ptone-2");
  assert.equal(one.length, 5, `person 1's row has ${one.length} stretches, not the five left behind`);
  assert.equal(two.length, 2, `person 2's row has ${two.length} stretches, not its own job plus the one handed over`);
  assert.ok(!one.includes(job), "the stretch she handed over is still on person 1's row");
  assert.ok(two.includes(job), "the stretch she handed over did not arrive on person 2's row");
  // And its two neighbours from the SAME batch did not follow it, which is the whole
  // of what she corrected: the batch is unchanged and the one slot under her finger
  // moved. The batch's other batch is up on person 1's row too, untouched, and is not
  // the thing being checked here.
  assert.ok(one.includes(first[0]), "the fold before it went with it");
  assert.ok(one.includes(first[2]), "the fold after it went with it");
  assert.ok(!two.includes(first[0]) && !two.includes(first[2]),
    "a fold beside the one she tapped was handed over too");

  // The model's own answer, which is what the editor's "Who is at this module" box
  // and the next phone to sync both read. The module keeps its person and its crew;
  // what is written is the one stretch, under the batch and stretch it belongs to.
  const fold = state.settings.scenario.modules.find((m) => m.id === "fold");
  assert.deepEqual(fold.slotPerson, { "0.1": 2 }, "the stretch she tapped is not the one that changed hands");
  assert.equal(fold.person, 1, "the module's own person was changed by a hand-over of one stretch");
  assert.equal(fold.person, fold.crew[0], "the module and its first line disagree about who is standing there");

  // And the card goes with the stretch. Its heading names the person it is being
  // taken off, and once the day has redrawn that person no longer holds it — so a
  // card left standing would offer a press against a state that is gone. Measured
  // on the layer itself, since an empty card and a closed one differ only here.
  assert.equal(walk(layers["popup-layer"]).length, 0,
    "the card is still on the screen after the move, describing a stretch that has left the row");
  assert.equal(layers["popup-layer"].hidden, true, "the card is empty but the layer is still showing");

  // And the module's own card can no longer say the whole of it. Without the note,
  // "Who is at this module" would read Person 1 while a marker of that module sat on
  // person 2's row — the card and the chart disagreeing about the same day.
  openModule(root, "The fold loop");
  assert.match(popupBody(), /Stretches handed on/, "the module's card says nothing about the stretch handed on");
  assert.match(popupBody(), /stretch of this module has been handed to somebody else: Person 2/,
    `the note does not name who holds it: ${popupBody().slice(0, 400)}`);
});

// ── The day that is sharing them out (v172) ────────────────────────────────
//
// Her report of 23 September 2026, in her words: "i have 4 persons, 1st Jien, 2nd
// Wei, 3rd and 4th. I saw Jien is heavy loaded, so i click one of Jien session, and
// select to switch that session to Wei, where he is free. BUt what happen is Jien
// disapper, and Jien name chage to Wei, and the originally Wei sessions disappeared".
//
// The day this happens on is the one with nobody placed at a module: every module on
// 0 and the rows drawn by the packing. There a row's number is not hers and not the
// module's — it is what peopleRows invented — while her names are kept BY NUMBER and
// shared by every scenario, so naming one stretch moved the packing's origin and
// re-numbered every row under her. Three things she saw, and this test pins all three.
//
// The v161 test above is the other half of the same gesture on a day that is NOT
// sharing them out, where nothing needs settling and nothing may be written down.
function sharedOutDay() {
  return ONE_BAKER_SCENARIO.modules.map((m) => ({
    ...m,
    person: 0, crew: undefined, slotPerson: undefined,
    starts: undefined, startDelta: undefined,
    startMin: 0, repeats: 1, count: 1, overlap: true,
  }));
}

// Every person row as its tone, the name on it and the jobs it carries — the three
// things she names in her report, read off the chart she is looking at.
function peopleOn(root) {
  return personRows(root).map((n) => ({
    tone: (String(n.className).match(/ptone-\d+/) || [""])[0],
    who: textOf(walk(n).find((x) => hasClass(x, "tl-name-txt"))),
    titles: barsOf(walk(n).find((x) => hasClass(x, "tl-track"))).map((b) => String(b.attrs.title)),
  }));
}

test("a hand-over on a day that is sharing them out leaves every other row, and its name, where it was (v172)", () => {
  const { root, state } = render({ modules: sharedOutDay() });
  // Her four names, as the person card writes them: in the app's settings, by number,
  // shared by every scenario she has.
  state.settings.personNames = { 1: "Jien", 2: "Wei" };
  renderScenario(root, state);

  const before = peopleOn(root);
  assert.ok(before.length >= 3,
    `the shared-out day draws ${before.length} row(s) of work, so there is no packed day here to re-number`);
  assert.equal(before[0].tone, "ptone-1", "the first row of a shared-out day is not person 1");
  assert.match(before[0].who, /Jien/, `the first row reads "${before[0].who}"`);
  assert.match(before[1].who, /Wei/, `the second row reads "${before[1].who}"`);
  assert.ok(before[0].titles.length >= 2,
    `the overloaded row carries ${before[0].titles.length} job(s), which cannot tell a move from a shift`);
  // The day really is sharing them out: not one module has anybody on it, so every
  // row number on this chart is the packing's own invention.
  assert.deepEqual(state.settings.scenario.modules.filter((m) => Number(m.person) > 0), [],
    "the day is not sharing them out after all — a module already has a person");

  // The one stretch she taps, in the row she says is overloaded.
  const track = personTrack(root, "ptone-1");
  const bar = barsOf(track)[1];
  const job = String(bar.attrs.title);
  assert.equal(tapSlot(track, px(bar, "left") + px(bar, "width") / 2), true,
    "a tap on the overloaded person's stretch opened nothing");
  assert.match(popupTitle(), /Move this slot off Jien/, `the tap opened "${popupTitle()}"`);
  // And it says what this press settles before she takes it, because the People box
  // changing to "Your own" is something she will see — and a change she can see is
  // one she is told about rather than left to find.
  assert.match(popupBody(), /settles the whole day/,
    `the card does not say what this press settles: ${popupBody().slice(0, 300)}`);
  assert.match(popupBody(), /stops saying it is sharing them out/,
    `the card does not say the box's own words are about to change: ${popupBody().slice(0, 300)}`);

  popupButton(/Move it to Wei/).dispatchEvent({ type: "click" });
  assert.match(lastToast(), /keeps the row it has/, `the press said "${lastToast()}"`);

  const after = peopleOn(root);
  // 1. Every row is still on the chart, in the same place, under the same name.
  // "Jien disapper" and "Jien name chage to Wei" were two thirds of her report.
  assert.deepEqual(after.map((r) => r.tone), before.map((r) => r.tone),
    "the rows on the chart are not the rows that were on it");
  assert.deepEqual(after.map((r) => r.who), before.map((r) => r.who),
    "a person's name has moved to another row");
  // 2. And no work moved with it bar the one stretch she tapped. "the originally Wei
  // sessions disappeared" was the third thing she saw.
  for (let i = 0; i < before.length; i += 1) {
    const lost = before[i].titles.filter((t) => !after[i].titles.includes(t));
    const gained = after[i].titles.filter((t) => !before[i].titles.includes(t));
    if (i === 0) {
      assert.deepEqual(lost, [job], `the overloaded row lost ${lost.length} stretch(es): ${lost.join(" | ")}`);
    } else {
      assert.deepEqual(lost, [], `row ${i + 1} (${before[i].who}) lost ${lost.join(" | ")}`);
    }
    if (i === 1) {
      assert.deepEqual(gained, [job], `Wei gained ${gained.join(" | ")}`);
    } else {
      assert.deepEqual(gained, [], `row ${i + 1} (${before[i].who}) gained ${gained.join(" | ")}`);
    }
  }

  // 3. The arrangement she was looking at is on the record, which is what makes the
  // numbers stop being the packing's. Every module that needs hands now says who is
  // standing at it; the stretch she moved is the one exception, kept as a hand-over
  // of its own, which is what the module's card reads the "Stretches handed on" note
  // from.
  const mods = state.settings.scenario.modules;
  for (const m of mods) {
    const needsHands = m.on !== false && Number(m.touchMin) > 0;
    const slots = Object.values(m.slotPerson || {});
    assert.ok(!needsHands || Number(m.person) > 0 || slots.length,
      `${m.name} was left with nobody on it, so its row number is still the packing's to invent`);
  }
  const moved = mods.find((m) => Object.values(m.slotPerson || {}).includes(2));
  assert.ok(moved, "the stretch she handed to Wei is not on the record as a hand-over");
  assert.equal(moved.person, 1, "the row the moved stretch came off was not written down");
  // And the day no longer describes itself as the arrangement this one press has
  // replaced. Every job now names the person standing at it, so the box reads One
  // to a module — and what matters here is the half it must NOT say any more: the
  // day is not sharing them out. A settled day that still read "Sharing them out"
  // would be inviting her to look for an arrangement that is no longer there.
  const closed = textOf(walk(root).find((n) => hasClass(n, "tl-select")));
  assert.doesNotMatch(closed, /Sharing them out/,
    `the People box still says the day is sharing them out: ${closed.slice(0, 80)}`);
  assert.match(closed, /One a module|One to a module/,
    `the People box does not name the arrangement now in force: ${closed.slice(0, 80)}`);
});

// The other half of the same press. A stretch handed back to nobody in particular is
// the day's own arrangement being asked for again, so nothing is settled and nobody
// is written down — and the People box has to go on saying the day is sharing them
// out. It is here because a hand-over writes the day back whole, and a day written
// back whole carries a crew on every module: read as an arrangement, a crew of
// zeroes would have the box claiming one person per job on a day that never moved.
test("a stretch handed back to whoever is free leaves the day sharing them out (v172)", () => {
  const { root, state } = render({ modules: sharedOutDay() });
  state.settings.personNames = { 1: "Jien", 2: "Wei" };
  renderScenario(root, state);
  const before = peopleOn(root);

  const track = personTrack(root, "ptone-1");
  const bar = barsOf(track)[1];
  assert.equal(tapSlot(track, px(bar, "left") + px(bar, "width") / 2), true,
    "a tap on the overloaded person's stretch opened nothing");
  const picker = walk(layers["popup-layer"]).find((n) => n.tagName === "SELECT");
  assert.ok(picker, "the card offers no list of people");
  picker.value = "0";
  picker.dispatchEvent({ type: "change" });
  popupButton(/Move it to whoever is free/).dispatchEvent({ type: "click" });

  // Nothing was pinned: not one module carries a person, so the rows on the chart are
  // still the packing's to invent — exactly as they were before the press.
  assert.deepEqual(state.settings.scenario.modules.filter((m) => Number(m.person) > 0), [],
    "handing a stretch back to nobody in particular pinned a person onto a module");
  assert.deepEqual(peopleOn(root).map((r) => r.tone), before.map((r) => r.tone),
    "the day's rows moved when a stretch was handed back to nobody in particular");
  const closed = textOf(walk(root).find((n) => hasClass(n, "tl-select")));
  assert.match(closed, /Sharing them out/,
    `a day that has not moved no longer says it is sharing them out: ${closed.slice(0, 80)}`);
});

// Found by measuring the fix on her own day rather than on a fixture: the card's note
// was written for a day that IS sharing them out and was drawn on every day the press
// would settle. Her day has one stretch already placed by hand, so its People box reads
// "Your own" — and the card told her the day was sharing them out and that the box was
// about to stop saying so, twice over about a day that said neither. The note is only
// ever allowed to claim what is true of the day in front of her.
test("a day that has already settled does not claim its box is about to stop sharing them out (v172)", () => {
  const mods = sharedOutDay();
  // One stretch placed by hand, on a day with nobody at a module — her own day's shape
  // as it stood when the fault was measured.
  mods[0].slotPerson = { "0.0": 2 };
  const { root, state } = render({ modules: mods });
  state.settings.personNames = { 1: "Jien", 2: "Wei" };
  renderScenario(root, state);

  const closedBefore = textOf(walk(root).find((n) => hasClass(n, "tl-select")));
  assert.match(closedBefore, /Your own/,
    `the day with one hand-placed stretch reads "${closedBefore.slice(0, 60)}", so this is not the case being measured`);

  const before = peopleOn(root);
  const heavy = before.reduce((a, b) => (b.titles.length > a.titles.length ? b : a), before[0]);
  assert.ok(heavy.titles.length >= 2,
    `no row carries more than ${heavy.titles.length} job(s), so the press being settled cannot be read`);
  const track = personTrack(root, heavy.tone);
  const bar = barsOf(track)[0];
  assert.equal(tapSlot(track, px(bar, "left") + px(bar, "width") / 2), true,
    "a tap on the heaviest person's stretch opened nothing");

  // The press really is bigger than the one stretch, so the note belongs on this card.
  assert.match(popupBody(), /settles the whole day/,
    `the card is silent about settling the day: ${popupBody().slice(0, 300)}`);
  // And it must not describe a day that is not in front of her. Both halves were wrong
  // on her own day: it is not sharing them out, and its box says "Your own".
  assert.doesNotMatch(popupBody(), /sharing them out/,
    `the card claims a box that is not saying it: ${popupBody().slice(0, 300)}`);
});

// Presses one of the People box's three answers, as she would off the phone's wheel.
function pressPeople(root, answer) {
  const sel = walk(ctlGroup(root, "People")).find((n) => n.tagName === "SELECT");
  assert.ok(sel, "the People group has no drop-down");
  sel.value = answer;
  sel.dispatchEvent({ type: "change" });
}
const closedPeople = (root) => textOf(walk(root).find((n) => hasClass(n, "tl-select")));
const handPlacedOn = (state) => state.settings.scenario.modules
  .flatMap((m) => Object.values(m.slotPerson || {}).filter((v) => Number(v) > 0));

// The answer to her own question — "how to rerun job assignment after we set the more
// details?" — is this box, and it answered only half way. A stretch placed by hand is
// read AHEAD of the module's own person (touchWindows), so "Share them out" cleared
// every module and left the hand-placed stretch standing: the toast said the day had
// been handed back, and the chart — and the box's own closed words, "Your own" — said
// it had not.
test("Share them out takes back a stretch placed by hand, so the box and the day agree (v178)", () => {
  const mods = sharedOutDay();
  // Her own day's shape when this was measured: nobody at a module, one stretch placed
  // by hand — solo_top's, on Wei.
  mods[0].slotPerson = { "0.0": 2 };
  const { root, state } = render({ modules: mods });
  state.settings.personNames = { 1: "Jien", 2: "Wei" };
  renderScenario(root, state);

  const closedBefore = closedPeople(root);
  assert.match(closedBefore, /Your own/,
    `the day with one hand-placed stretch reads "${closedBefore.slice(0, 60)}", so this is not the case being measured`);
  const before = peopleOn(root);
  // The stretch really is on Wei's row, and its own title is what has to leave it.
  // Read off the row itself rather than off a number the row does not carry: a person
  // row draws its own markers, so the stretch is the job whose title names the module
  // she pinned.
  const pinnedName = `${state.settings.scenario.modules[0].name}:`;
  const placed = barsOf(personTrack(root, "ptone-2")).find((b) => String(b.attrs.title).startsWith(pinnedName));
  assert.ok(placed, "the hand-placed stretch is not drawn on Wei's row, so nothing here can be read");
  const placedTitle = String(placed.attrs.title);

  pressPeople(root, "share");

  // 1. Nothing is placed by hand any more — which is what makes the box's own words
  // true rather than a claim about a day that is still arranged her way.
  assert.deepEqual(handPlacedOn(state), [],
    "a stretch placed by hand survived the press, so the old arrangement is still on the chart");
  // And the key itself is gone rather than left empty: "not placed by hand" has one
  // spelling in this app, and an empty map is a second one that would still travel to
  // the cloud and still be read back as a day with something written on it.
  for (const m of state.settings.scenario.modules) {
    assert.ok(!("slotPerson" in m),
      `${m.name} was left holding an empty slotPerson, which is a second way of saying nobody`);
  }
  // 2. And the box now says what the press did.
  const closed = closedPeople(root);
  assert.match(closed, /Sharing them out/,
    `after sharing them out the box reads "${closed.slice(0, 60)}"`);
  // 3. The chart moved with it: the stretch she had put on Wei is off her row.
  assert.ok(!titlesOf(root, "ptone-2").includes(placedTitle),
    `Wei still carries the stretch that was handed back: ${titlesOf(root, "ptone-2").join(" | ")}`);
  // 4. And the day is exactly the day the app would have packed with no stretch ever
  // placed — not a half-mixture of her numbers and its own.
  const plain = render({ modules: sharedOutDay() });
  plain.state.settings.personNames = { 1: "Jien", 2: "Wei" };
  renderScenario(plain.root, plain.state);
  assert.deepEqual(peopleOn(root), peopleOn(plain.root),
    "the day handed back is not the day the app would pack on its own");
  assert.notDeepEqual(peopleOn(root), before,
    "the chart is byte for byte the day it was, so nothing was handed back at all");
});

// Taking back a decision of hers is a change she is told about, and one with nothing to
// tell is not told anything extra: a count of zero is not news.
test("both full-day presses say how many hand-placed stretches they took back (v178)", () => {
  const two = sharedOutDay();
  two[0].slotPerson = { "0.0": 2 };
  two[1].slotPerson = { "0.0": 3 };
  const { root, state } = render({ modules: two });
  state.settings.personNames = { 1: "Jien", 2: "Wei", 3: "Aina" };
  renderScenario(root, state);
  assert.equal(handPlacedOn(state).length, 2, "the two hand-placed stretches are not both on the day");

  pressPeople(root, "share");
  assert.match(lastToast(), /2 stretches you had placed by hand go back on the day's own arrangement/,
    `the press said "${lastToast()}"`);

  // The same press on a day with nothing of hers on it promises nothing it did not do.
  const { root: clean } = render({ modules: sharedOutDay() });
  pressPeople(clean, "share");
  assert.doesNotMatch(lastToast(), /placed by hand/,
    `a day with no hand-placed stretch said it took one back: "${lastToast()}"`);
});

// The other full-day press has the same trap and the same fix: a hand-placed stretch
// would sit on its own row inside the one-to-a-module arrangement the press had just
// given every job, so one job would have no person of its own while the toast claimed
// otherwise.
test("One a module takes a hand-placed stretch back too, so every job gets its own person (v178)", () => {
  const mods = sharedOutDay();
  mods[0].slotPerson = { "0.0": 2 };
  const { root, state } = render({ modules: mods });
  state.settings.personNames = { 1: "Jien", 2: "Wei" };
  renderScenario(root, state);

  pressPeople(root, "one");

  assert.deepEqual(handPlacedOn(state), [],
    "a stretch placed by hand survived the press, so one job is short of the person the press gave it");
  for (const m of state.settings.scenario.modules) {
    assert.ok(!("slotPerson" in m),
      `${m.name} was left holding an empty slotPerson, which is a second way of saying nobody`);
  }
  assert.match(lastToast(), /1 stretch you had placed by hand goes back/,
    `the press said "${lastToast()}"`);
  assert.match(lastToast(), /now move the modules closer together/,
    `the press no longer says what it always said: "${lastToast()}"`);
  // And the job really is on the person the press gave it: person 1's row carries the
  // first module's first stretch, where the hand-placed stretch had it on Wei.
  assert.ok(titlesOf(root, "ptone-1").length,
    "the first person has nothing on their row after the press named one person per job");
});

test("a tap on a person's empty day still opens their own card (v160)", () => {
  // The other half of the gesture: the tap must only be swallowed where there is a
  // job under it. One person with one stretch of work leaves the rest of their row
  // as empty ground, and a tap there has to fall through to the row's own handler —
  // which is what opens the person's card, exactly as it did before this release.
  const { root } = render({ modules: oneJobDay() });
  const track = personTrack(root, "ptone-1");
  const bars = barsOf(track);
  assert.equal(bars.length, 4, "the one-job day does not draw four batches for person 1");

  const scale = 1.6;
  const trackW = px(track, "width");
  const right = Math.max(...bars.map((b) => px(b, "left") + px(b, "width")));
  // Past the last stretch by a fingertip's reach and a whole minute more, and
  // still inside the day — so the only reason nothing is found there is that
  // nothing is there.
  const gapX = right + Math.max(2 * scale, 6) + scale + 2;
  assert.ok(gapX < trackW - 1,
    `the day ends at ${trackW}px with the last stretch at ${right}px, so there is no empty ground to tap`);
  assert.equal(tapSlot(track, gapX), false,
    "a tap where the person is not working was swallowed by the marker's own handler");

  // A tap just past a marker's edge is still that marker: a one-minute job is 1.2
  // pixels at the widest reading, so a finger lands beside a job far more often
  // than on it. Without the reach the narrow end of the scale could not be tapped.
  const last = bars[bars.length - 1];
  const lastJob = String(last.attrs.title || "");
  assert.ok(lastJob, "the last marker of the day does not name its job");
  assert.equal(tapSlot(track, px(last, "left") + px(last, "width") + 2), true,
    "a tap beside a marker found nothing, so a sliver of a job cannot be tapped");
  assert.ok(popupBody().includes(lastJob),
    `the nearest-stretch reach opened a card about something else: ${popupBody().slice(0, 180)}`);
});

test("a day with nobody else on it says so rather than offering an empty list (v160)", () => {
  // Every module on one person, so there is no second row to hand anything to. The
  // click is real — the day is hers and the gesture is hers — so the card must
  // answer rather than open a menu with nothing in it.
  const { root } = render({ modules: ONE_BAKER_SCENARIO.modules.map((m) => ({ ...m, person: 1 })) });
  assert.equal(personRows(root).length, 1, "the day does not have exactly one person on it");
  // The shim's pop-up layer is one layer for the whole file, so it is emptied here:
  // what this test asks is whether THIS tap opened anything, not what the test
  // before it left lying there.
  layers["popup-layer"].replaceChildren();
  const track = personTrack(root, "ptone-1");
  const bar = barsOf(track)[0];
  assert.equal(tapSlot(track, px(bar, "left") + px(bar, "width") / 2), true,
    "a tap on a job with nobody to hand it to did nothing at all");
  assert.match(lastToast(), /Nobody else is on this day/,
    `the tap said "${lastToast()}" instead of saying there is nobody else`);
  // The tap is answered and swallowed rather than opening a second card over the
  // first: the person's own card is one tap away on the row around this job.
  assert.equal(walk(layers["popup-layer"]).filter((n) => n.tagName === "SELECT").length, 0,
    "a card with an empty list of people was opened");
});

// ── The cycles of one batch (v164) ──────────────────────────────────────────
//
// Every number in the cycles list is written by touching that one box, and the
// card is deliberately NOT repainted while she types (v142: a rebuild would throw
// the box out from under her finger). So each box has to write onto the list as
// it stands, never onto a copy taken when the card was built — or the second box
// she touches drags the first one back to what it was when the card opened.
//
// Measured on her own fold module before this: cycle 1's Minutes 31 → 40, then
// cycle 2's Unload, and cycle 1 was back to 31 while its box still read 40. The
// screen and the day disagreed, and the number looked as though it had changed by
// itself.
test("a number typed into one cycle box is not undone by the next box she touches (v164)", () => {
  const { root, state } = render();
  const fold = () => state.settings.scenario.modules.find((m) => m.id === "solo_fold");
  assert.equal(fold().cycles.length, 4, "the fold module no longer has the four cycles this is measured on");

  openModule(root, "The rests and the stretch and folds");
  const box = (label, i) => walk(layers["popup-layer"])
    .find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === `${label} in cycle ${i + 1}`);
  const type = (label, i, v) => {
    const input = box(label, i);
    assert.ok(input, `the card has no ${label} box on cycle ${i + 1}`);
    input.value = String(v);
    input.dispatchEvent({ type: "input" });
  };

  // Cycle 1's Minutes, then cycle 2's Unload. The first number must survive the
  // second box — this is the fault she saw.
  type("Minutes", 0, 40);
  assert.equal(fold().cycles[0].min, 40, "the first box she used did not reach the module");
  type("Unload", 1, 2);
  assert.equal(fold().cycles[1].unload, 2, "the second box she used did not reach the module");
  assert.equal(fold().cycles[0].min, 40,
    "the second box she touched put cycle 1's Minutes back to where it was when the card opened");

  // Two boxes on ONE row are the same case: Load, then Minutes beside it.
  type("Load", 0, 5);
  type("Minutes", 0, 44);
  assert.equal(fold().cycles[0].load, 5, "a box on the same row was undone by the box beside it");
  assert.equal(fold().cycles[0].min, 44, "the Minutes box did not reach the module");

  // A cycle's own name is a box like any other.
  const nameBox = walk(layers["popup-layer"]).filter((n) => hasClass(n, "cyc-name"))[2];
  assert.ok(nameBox, "the card has no name box for cycle 3");
  nameBox.value = "Fold 3";
  nameBox.dispatchEvent({ type: "input" });
  assert.equal(fold().cycles[2].name, "Fold 3", "renaming a cycle did not reach the module");
  assert.equal(fold().cycles[0].load, 5, "renaming a cycle undid a number she had typed");
  assert.equal(fold().cycles[0].min, 44, "renaming a cycle undid a number she had typed");
});

// ── Two windows, one slider (v167) ──────────────────────────────────────────
//
// Her report of 23 September: "the window for person stay over size", which she
// confirmed was the blank space under the people's rows — 177px of it at 375x812,
// because the panel was a FIXED 650px tall while her day's content came to 473 and
// the people's rows ended at y=457. Her own proposal, and what was built: "instead
// of consider then one window, why not create 2 windows, and let the ruler sync in
// the 2 windows. As the business grows, the persons will grows, processs might not,
// we need to have a better way to manage". Then, watching it go in: "can the 2
// window share the horizontal slider, place between the 2 windows, make the 2
// windows as close as possible" — and, asked what sits under the slider, "slider,
// then straight into their bars".

test("the chart is two windows and nothing between them (v167, v168)", () => {
  const { root } = render();
  const wrap = wrapOf(root);
  assert.ok(wrap, "the chart is not drawn as two windows");
  const proc = paneOf(root, "proc");
  const people = paneOf(root, "people");
  assert.ok(proc && people, "the chart does not draw both windows");

  // Both are windows in the same sense: each wears the class that scrolls it and
  // pins its name column, each holds its own inner, and each is watched for a pan.
  for (const p of [proc, people]) {
    assert.ok(hasClass(p, "tl"), `a window does not wear the class that scrolls it: ${p.className}`);
    assert.equal(kidElements(p).filter((n) => hasClass(n, "tl-inner")).length, 1,
      "a window does not hold exactly one day");
    assert.ok((p._listeners.scroll || []).length, "a window is not watched for panning, so the two cannot stay in step");
  }

  // Adjacent, with nothing at all between them: her ask at v167 was "make the 2
  // windows as close as possible", and at v168 she took out what had been sitting
  // there — "since the both windows have their own slider, additional slider is
  // redundent. Remove that". Asserted as adjacency rather than as a list that holds
  // the right two things, so a third element cannot be slipped between them.
  const strip = kidElements(wrap);
  assert.deepEqual(strip.map((n) => (n === proc ? "proc" : n === people ? "people" : "other")),
    ["proc", "people"],
    "the two windows are not stacked with nothing between them");
  assert.equal(strip.indexOf(proc) + 1, strip.indexOf(people),
    "something stands between the modules' window and the people's");

  // No slider is built at all, anywhere in the chart, and none is left in the
  // stylesheet for one — a rule with nothing on the screen wearing it is the next
  // reader's puzzle. And the panes' own horizontal scrollbars are the pan, so
  // nothing hides them any more: v167 hid them with ::-webkit-scrollbar, which only
  // WebKit and Blink honour, and that is why she saw three bars instead of one.
  assert.equal(walk(root).filter((n) => n.tagName === "INPUT" && hasClass(n, "tl-slider")).length, 0,
    "a slider is still built into the chart");
  const css = read("admin/css/app.css");
  assert.doesNotMatch(css, /\.tl-slider/, "the slider's rules are still in the stylesheet with nothing wearing them");
  assert.doesNotMatch(css, /-webkit-scrollbar:horizontal|scrollbar-corner/,
    "a window's own horizontal scrollbar is still hidden, so it is not the pan");
  assert.match(css, /\.tl\s*\{[^}]*overflow:\s*auto/, "a window no longer holds the horizontal overflow that pins its names");
});

test("the modules are in the top window and the people in the bottom one (v167)", () => {
  const { root } = render();
  const proc = paneOf(root, "proc");
  const people = paneOf(root, "people");
  const block = walk(people).find((n) => hasClass(n, "tl-people"));
  assert.ok(block, "the people's window holds no people");
  assert.equal(walk(proc).filter((n) => hasClass(n, "tl-people")).length, 0,
    "the people's block is inside the modules' window as well, so it is drawn twice");

  // Every module has a row in the top window and no row in the bottom one. Named
  // rather than counted, so a row that moved between the windows cannot pass by
  // arithmetic alone — and guarded on the class a MODULE row wears, because since
  // v158 a person's tip names the modules that person attends.
  for (const m of ONE_BAKER_SCENARIO.modules) {
    assert.ok(walk(proc).some((n) => hasClass(n, "tl-row") && !hasClass(n, "person") && textOf(n).includes(m.name)),
      `the row for "${m.name}" is not in the modules' window`);
    assert.ok(!walk(people).some((n) => hasClass(n, "tl-row") && !hasClass(n, "person") && textOf(n).includes(m.name)),
      `a module row for "${m.name}" is in the people's window`);
  }
  assert.ok(personRows(people).length, "the people's window holds no person rows");
  assert.equal(personRows(proc).length, 0, "a person's row is inside the modules' window");

  // And the clock is in the top window only. That is her own choice about what sits
  // under the slider — "slider, then straight into their bars" — and it is also
  // what keeps v163's rule, that no clock is drawn above the people's rows, true.
  assert.equal(walk(people).filter((n) => hasClass(n, "tl-ruler")).length, 0,
    "the people's window carries a clock row of its own");
  assert.match(read("admin/css/app.css"), /\.tl-pane-people\s*\{[^}]*max-height/,
    "the people's window has no cap, so it can grow into the modules'");
});

test("panning one window pans the other, with no write back to the one under her finger (v167, v168)", () => {
  const { root } = render();
  const proc = paneOf(root, "proc");
  const people = paneOf(root, "people");

  // Give both windows the box a browser would: a day wider than the window.
  giveThemAWindow(root);
  proc.scrollLeft = 300;
  const wrote = [watchWrites(proc), watchWrites(people)];
  proc.dispatchEvent({ type: "scroll" });
  flushFrames();
  assert.equal(people.scrollLeft, 300, "panning the modules' window did not move the people's");
  assert.equal(wrote[0](), 0, "the sync wrote back to the window the pan came from");
  assert.equal(wrote[1](), 1, `the other window was written ${wrote[1]()} times, not once`);
  // And then the ECHO, which is the whole reason the sync uses a one-pixel deadband
  // rather than a lock. Assigning scrollLeft does not fire scroll synchronously in
  // Chrome or WebKit: it is queued to the next rendering opportunity, so a lock set
  // before our write and cleared after it is already clear when the echo arrives,
  // the echo is not suppressed, and it writes back to the window under her finger —
  // which is the documented way to stop a flick dead on iOS. A frame later, having
  // moved the people's window, the browser fires scroll on it. That echo must find
  // nothing left to do.
  people.dispatchEvent({ type: "scroll" });
  flushFrames();
  assert.equal(wrote[0](), 0, "the echo of the sync's own write came back to the window her finger is on");
  assert.equal(wrote[1](), 1, "the echo moved a window that was already in step");

  // And the same the other way, so what is being asserted is a lockstep rather than
  // one window that follows the other: whichever window carries her finger, the
  // other is the one that is written.
  people.scrollLeft = 900;
  people.dispatchEvent({ type: "scroll" });
  flushFrames();
  assert.equal(proc.scrollLeft, 900, "panning the people's window did not move the modules'");
});

// ── The right-press pan (v171) ──────────────────────────────────────────────
// Her ask of 23 September: "can i drag the module window up/down, left/right by right
// click and hold? Dont let this action open up the card." Three rules come out of that
// sentence and each is proved below: the right button drags a window's day, both
// windows answer to the same hand, and a right press — on a bar above all, because a
// bar is where her hand will be — opens nothing.

// A right press, held, and moved to the second point. `button: 2` is the right button
// and `buttons: 2` is "it is still down", which is what a real pointermove carries
// while she drags. A press with neither is what the shim would otherwise be given, and
// it would exercise the guard on the button rather than the pan.
function rightDrag(pane, from, to) {
  pane.dispatchEvent({ type: "pointerdown", button: 2, buttons: 2, clientX: from[0], clientY: from[1], pointerId: 7 });
  pane.dispatchEvent({ type: "pointermove", button: 2, buttons: 2, clientX: to[0], clientY: to[1], pointerId: 7 });
}

test("a right press and hold drags a window's day both ways (v171)", () => {
  const { root } = render();
  const proc = paneOf(root, "proc");
  giveThemAWindow(root);
  proc.scrollLeft = 300; proc.scrollTop = 120;
  // The pointer goes LEFT and UP, so the day follows her hand: further right and
  // further down the day. A pan that moved the same way as the pointer would be a
  // joystick, not a hand on the paper.
  rightDrag(proc, [400, 300], [340, 260]);
  assert.equal(proc.scrollLeft, 360, "dragging left did not bring the day right");
  assert.equal(proc.scrollTop, 160, "dragging up did not bring the day down");
  // And the window says the gesture has taken hold, which is what turns the cursor into
  // a hand closed on the paper and stops a drag from selecting the words underneath it.
  assert.ok(proc.classList.contains("tl-dragging"), "a held right press did not mark the window as being dragged");

  // Let go, and the day stays where she left it. A move after the release is not a
  // drag, or a pointer that wandered on would carry the day with it.
  proc.dispatchEvent({ type: "pointerup", button: 2, clientX: 340, clientY: 260 });
  assert.ok(!proc.classList.contains("tl-dragging"), "the window still says it is being dragged after she let go");
  proc.dispatchEvent({ type: "pointermove", buttons: 2, clientX: 200, clientY: 100 });
  assert.equal(proc.scrollLeft, 360, "the day went on moving after she let go");
  assert.equal(proc.scrollTop, 160, "the day went on moving after she let go");

  // The second way a release arrives, and the one that leaves a window stuck to her
  // pointer if it is not answered: she let go somewhere the release never reached, so
  // the next move is the first thing that says the button is up. That move ends the
  // drag instead of panning, and the moves after it pan nothing either.
  proc.scrollLeft = 300; proc.scrollTop = 120;
  proc.dispatchEvent({ type: "pointerdown", button: 2, buttons: 2, clientX: 400, clientY: 300, pointerId: 7 });
  proc.dispatchEvent({ type: "pointermove", buttons: 0, clientX: 380, clientY: 300, pointerId: 7 });
  assert.equal(proc.scrollLeft, 300, "a move with the button already up dragged the day");
  assert.ok(!proc.classList.contains("tl-dragging"), "the window kept its closed hand after a release it never saw");
  proc.dispatchEvent({ type: "pointermove", buttons: 2, clientX: 340, clientY: 300, pointerId: 7 });
  assert.equal(proc.scrollLeft, 300, "the window stayed stuck to her pointer after a release it never saw");

  // And the LEFT button is not the pan. It is the press that opens cards, and one that
  // opened a card while nudging the day would move the thing she is reading it against.
  // It does not take hold of the window either: a left press that marked the window as
  // being dragged would close the cursor on the paper for a press that opens a card.
  proc.dispatchEvent({ type: "pointerdown", button: 0, buttons: 1, clientX: 400, clientY: 300, pointerId: 6 });
  assert.ok(!proc.classList.contains("tl-dragging"), "a left press took hold of the window as if it were a pan");
  proc.dispatchEvent({ type: "pointermove", button: 0, buttons: 1, clientX: 340, clientY: 260, pointerId: 6 });
  assert.equal(proc.scrollLeft, 300, "a left press panned the day");
  assert.equal(proc.scrollTop, 120, "a left press panned the day");

  // And a window cannot be dragged past the day's own start, whichever way she pulls.
  proc.scrollLeft = 0; proc.scrollTop = 0;
  rightDrag(proc, [200, 200], [500, 400]);
  assert.equal(proc.scrollLeft, 0, "dragging right scrolled the day back past its own start");
  assert.equal(proc.scrollTop, 0, "dragging down scrolled the day back past its own start");
});

test("both windows are dragged by the same hand, and sideways brings the other with it (v171)", () => {
  const { root } = render();
  const proc = paneOf(root, "proc");
  const people = paneOf(root, "people");
  giveThemAWindow(root);
  people.scrollLeft = 500;
  // The people's window is the same kind of pane, so it answers to the same gesture.
  // A gesture that worked in one window and did nothing in the other would read as a
  // fault, and this is the test that says the two cannot be wired apart.
  rightDrag(people, [600, 200], [480, 200]);
  assert.equal(people.scrollLeft, 620, "the people's window did not answer a right-press drag");
  // And sideways it needs no second write path: the drag sets scrollLeft, which is
  // what the sync above is already listening for. A browser queues that scroll event
  // to the next rendering opportunity; this shim has no queue of its own for it, so
  // the test fires the event the browser would.
  people.dispatchEvent({ type: "scroll" });
  flushFrames();
  assert.equal(proc.scrollLeft, 620, "a drag in one window left the other one behind");
});

test("a right press on a bar drags the day instead of opening its card (v171)", () => {
  const { root } = render();
  // The popup layer is shared across the whole file, so a card an earlier test opened
  // is still standing in it. Emptied here, because "nothing was opened" is only worth
  // asserting against a layer that was empty to begin with.
  layers["popup-layer"].replaceChildren();
  const proc = paneOf(root, "proc");
  giveThemAWindow(root);
  proc.scrollLeft = 400;
  const name = "The rests and the stretch and folds";
  const bar = rowFor(root, name)[0];
  const track = trackFor(root, name);
  // Her hand lands on a bar, because the bars cover most of the day and every one of
  // them opens a card on a left press — that is the press this must not be. The
  // gesture is a press on the WINDOW that happens to be over a bar, so it is aimed
  // where her hand is rather than at the bar itself.
  proc.dispatchEvent({ type: "pointerdown", button: 2, buttons: 2, clientX: 700, clientY: 300, pointerId: 8 });
  proc.dispatchEvent({ type: "pointermove", button: 2, buttons: 2, clientX: 660, clientY: 300, pointerId: 8 });
  proc.dispatchEvent({ type: "pointerup", button: 2, clientX: 660, clientY: 300, pointerId: 8 });
  assert.equal(proc.scrollLeft, 440, "a right press over a bar did not drag the day");
  // A browser fires no click at all for the right button. This is the synthetic one it
  // would fire if it did — the half the app owns, and the half a test can aim at a bar.
  // It must open nothing.
  track.dispatchEvent({ type: "click", button: 2, target: { closest: () => bar }, stopPropagation() {} });
  assert.equal(popupBody(), "", "a right press on a bar opened its card");
  // And the left press it is being told apart from is untouched: same bar, same card.
  tapBar(root, name, 0);
  assert.ok(popupBody(), "a left press on a bar no longer opens its card");
});

test("the browser's own menu never opens over the chart, and the right press is not a reading (v171)", () => {
  const { root } = render();
  // The menu is the one thing a right press would otherwise put on the screen, and it
  // would land in the middle of the gesture that press is starting.
  for (const which of ["proc", "people"]) {
    const ev = { type: "contextmenu", button: 2 };
    paneOf(root, which).dispatchEvent(ev);
    assert.ok(ev.defaultPrevented, `the browser's own menu still opens over the ${which} window`);
  }

  // And one press is one gesture: the clock strip's reading is taken with the left
  // button, so a right press that is panning the day does not drag a reading with it.
  const proc = paneOf(root, "proc");
  const band = walk(walk(proc).find((n) => hasClass(n, "tl-ruler"))).find((n) => hasClass(n, "tl-track"));
  const cursor = walk(proc).find((n) => hasClass(n, "tl-cursor"));
  const lab = walk(proc).find((n) => hasClass(n, "tl-cursor-lab"));
  band.dispatchEvent({ type: "pointerdown", button: 2, buttons: 2, clientX: 400, clientY: 100, pointerId: 9 });
  assert.equal(cursor.hidden, true, "a right press on the clock strip dragged a reading with it");
  band.dispatchEvent({ type: "pointerdown", clientX: 400, clientY: 100, pointerId: 9 });
  band.dispatchEvent({ type: "pointerup", clientX: 400, clientY: 100, pointerId: 9 });
  assert.ok(!cursor.hidden && lab.textContent, "a left press on the clock strip no longer takes a reading");
});

// Her words of 23 September: "put the clock balon 2 inches higher than. cursor". The
// balloon that reads the clock used to sit eight pixels above her pointer, which put
// it on her hand rather than above the line; it is lifted two inches clear now, and
// this is what holds it there.
//
// The window here is deliberately shorter than the day, because that is the case the
// lift can get wrong: a lift measured against the DAY would carry the balloon off the
// window she is looking through, and hide it exactly when there is a full day to read.
// Measured against the window, it stays inside it — above her pointer where the two
// inches fit there, and below it where they do not. Below and not pinned to the
// window's top, because the clock strip she presses with a finger is AT the top of the
// modules' window, and a balloon resting on the window's top is a balloon on her hand.
test("the clock balloon keeps two inches of clearance from the cursor, above it or below it (v171)", () => {
  const { root } = render();
  const proc = paneOf(root, "proc");
  const band = walk(walk(proc).find((n) => hasClass(n, "tl-ruler"))).find((n) => hasClass(n, "tl-track"));
  const cursor = walk(proc).find((n) => hasClass(n, "tl-cursor"));
  const lab = walk(proc).find((n) => hasClass(n, "tl-cursor-lab"));
  const frame = cursor.parentNode;
  assert.ok(frame && hasClass(frame, "tl-inner"), "the hairline is not drawn into the day's own box");

  // The day is 600 tall and the window is 300 of it, scrolled 200 down — so the top
  // of the window is at 200 in the day's own coordinates. A reading placed in DAY
  // coordinates and one placed in WINDOW coordinates are different numbers here, and
  // that difference is the whole of this test.
  frame._rect = { left: 0, top: -200, width: 600, height: 600 };
  proc._rect = { left: 0, top: 0, width: 600, height: 300 };
  const H = 18;               // the balloon's own height, which the view falls back to
  const LIFT = 2 * 96;        // two CSS inches, the unit she named
  // The balloon's top is written in the day's own coordinates, and so is the pointer
  // once the day's own top is taken off it. Both are inside the same scrolled box, so
  // the difference between them is also the distance on the screen — which is the
  // distance she is asking about.
  const inDay = (clientY) => clientY - frame.getBoundingClientRect().top;

  // A pointer well down the window: the balloon sits the whole two inches above it.
  band.dispatchEvent({ type: "pointerdown", clientX: 400, clientY: 250, pointerId: 31 });
  const deep = stylePx(lab, "top");
  assert.equal(inDay(250) - (deep + H), LIFT,
    `the balloon sits ${inDay(250) - (deep + H)}px above her pointer, not the two inches she asked for`);

  // A pointer NEAR THE TOP of the window — which is where the clock strip she presses
  // with a finger is. There is not two inches of window above her, and there IS two
  // inches below, so the balloon takes the same two inches BELOW rather than coming to
  // rest on the window's top. Measured here: the window's top is 200 in the day's own
  // coordinates and her pointer is at 250, a 50-pixel gap — which is exactly where a
  // balloon pinned to the window's top would have landed, on her hand.
  band.dispatchEvent({ type: "pointerdown", clientX: 400, clientY: 50, pointerId: 32 });
  const nearTop = stylePx(lab, "top");
  assert.equal(nearTop - inDay(50), LIFT,
    `a balloon with no room above her pointer sits ${nearTop - inDay(50)}px below it, not the two inches she asked for`);
  assert.ok(nearTop - 200 > 20,
    "the balloon came to rest on the window's own top, which is where her finger is when she drags the clock strip");

  // And a pointer in the middle of a window too short to hold two inches either side
  // keeps the reading on the screen and on the far side of the line: with neither side
  // able to hold the lift it comes to rest at the window's top, and that is still
  // ABOVE her pointer, never on it and never off the window.
  band.dispatchEvent({ type: "pointerdown", clientX: 400, clientY: 100, pointerId: 33 });
  const boxed = stylePx(lab, "top");
  assert.equal(boxed, 200, "a balloon with no room either side did not come to rest at the window's own top");
  assert.ok(inDay(100) - boxed > 0, "the balloon dropped BELOW the pointer when neither side of it had room");
  band.dispatchEvent({ type: "pointerup", clientX: 400, clientY: 100, pointerId: 33 });
});

// "the batch pop up, make it as brief as possible" — her words of 23 September.
// The card says the four readings and offers the three presses, and nothing else: the
// paragraph that used to sit under each pair, and the second line that repeated the
// two times the line above already reads out, are gone. What is pinned here is that the
// readings she needs to move a batch survived the cut — a brief card that lost a fact
// would be a card that hid the thing it was opened for.
test("the batch card is four readings and three presses, with no paragraph left on it (v171)", () => {
  const { root } = render();
  layers["popup-layer"].replaceChildren();
  tapBar(root, "Cutting and packing", 1);
  const body = popupBody();
  assert.match(body, /Batch 2/, "the card no longer says which batch it is");
  assert.match(body, /on the line/, "the card no longer says how the batch sits against the line");
  assert.match(body, /→/, "the card no longer reads out the batch's two times");
  assert.match(body, /min/, "the card no longer says how long the batch takes");
  assert.ok(popupButton(/\+ 5 min/) && popupButton(/− 5 min/), "the five-minute pair left the card");
  assert.ok(popupButton(/\+ 1 min/) && popupButton(/− 1 min/), "the one-minute pair left the card");

  // And the prose is gone: no sentence of explanation stands on the card. A hint that
  // is still needed belongs on the press as its own accessible name, which is where
  // the view keeps it now.
  const prose = walk(layers["popup-layer"]).filter((n) => hasClass(n, "hint") || hasClass(n, "card-sub"));
  assert.equal(prose.length, 0,
    `${prose.length} hint or sub line(s) are still standing on the batch card`);
});

test("the batch card's presses still carry what they do, now that the prose is off the card (v171)", () => {
  const { root, state } = render();
  layers["popup-layer"].replaceChildren();
  const pack = () => state.settings.scenario.modules.find((m) => m.id === "solo_pack");
  const was = starts(state, "solo_pack").slice();
  tapBar(root, "Cutting and packing", 1);
  // The buttons own the sentence now, so a press is still explained where she presses
  // it — and the press itself is untouched: it is still written as a hold on that
  // batch and nothing else came with it.
  const plus = popupButton(/\+ 5 min/);
  assert.match(String(plus.getAttribute("aria-label") || ""), /later/,
    "the five-minute press no longer says which way it moves the batch");
  assert.match(String(popupButton(/− 5 min/).getAttribute("aria-label") || ""), /earlier/,
    "the five-minute press no longer has a way back");
  plus.dispatchEvent({ type: "click" });
  assert.equal(pack().startDelta[1], 5, "the press stopped writing the hold it always wrote");
  assert.equal(pack().startDelta[0], 0, "the press moved a batch it should not have");
  assert.match(lastToast(), /Batch 2 held back 5 minutes/, "the press stopped saying what it did");
  assert.deepEqual(starts(state, "solo_pack").slice(0, 1), was.slice(0, 1), "batch 1 moved with it");
});

// A brief card is not a card with its own reading cut off at the edge, and that is
// what the brief batch card did first: its readings went onto one line, and at a
// phone's width the line ran off the card — "Batch 2  on the line  8:51 am → 8:5" was
// all that fitted, with the end time, the clock she opened the card for, past the
// edge. A reading is `flex: 0 0 auto` on purpose (a time must never be squeezed to
// nothing), so a row one word too wide does not shrink to fit — it overflows. The
// row WRAPS now, and this is what stands on it, because the same four readings on the
// same phone are the documented reproduction.
test("a card's readings wrap rather than running off the card (v171)", () => {
  const css = read("admin/css/app.css");
  const rule = css.match(/(^|\n)\.cyc-line\s*\{([^}]*)\}/);
  assert.ok(rule, "the shared reading row is no longer in the stylesheet at all");
  const body = rule[2];
  assert.match(body, /flex-wrap:\s*wrap/,
    "a card's readings are back on one line, so a row too wide for the card is clipped at its edge again");
  assert.doesNotMatch(body, /flex-wrap:\s*nowrap/,
    "the reading row is explicitly forbidden to wrap, so its readings are clipped again");
  // And the readings still refuse to be squeezed, which is WHY the row has to wrap:
  // two settings that have to agree, asserted together so neither can be changed alone.
  assert.match(css, /\.cyc-at\s*\{[^}]*flex:\s*0\s+0\s+auto/,
    "a reading is now able to shrink, so a time can be squeezed to nothing instead of the row wrapping");
});

// The two windows must be able to pan to the same place, or the same minute sits at
// two different points on one screen — the one thing the ruler exists to settle.
// They hold the same day, so the only thing that could ever pull them apart is an
// element hanging past the end of it, which is exactly what the last hour of the
// ruler used to do: its name was set to the right of its own line, off the end of
// the day, and it made the modules window 47 pixels wider than the people's (2,507
// against 2,460, measured live at 375x812). The name is on the other side of its
// line now, and this is what stands on it.
test("the ruler's last name cannot widen the modules' window past the people's (v168)", () => {
  const { root } = render();
  const ruler = walk(root).find((n) => hasClass(n, "tl-ruler"));
  const ticks = walk(ruler).filter((n) => hasClass(n, "tl-tick"));
  const labelled = ticks.filter((n) => walk(n).some((x) => x.tagName === "SPAN"));
  assert.ok(labelled.length > 1, "the ruler is not labelling its hours at all");

  // Exactly one tick is turned round: the last hour of the day, and it is the last
  // LABELLED one. A tick turned round anywhere else would mean the ruler's names are
  // being written on the wrong side of their lines in the middle of the day.
  const turned = ticks.filter((n) => hasClass(n, "last"));
  assert.equal(turned.length, 1, `${turned.length} ticks are turned round, not the day's last hour`);
  assert.equal(turned[0], labelled[labelled.length - 1], "the tick turned round is not the last hour of the day");
  assert.notEqual(labelled[0], turned[0], "the tick at the day's own start was turned round, so its name is off the day");

  // And the stylesheet does turn it round: the name goes to the left of the line,
  // with no layout width of its own to push the day wider.
  const css = read("admin/css/app.css");
  assert.match(css, /\.tl-tick\.last\s*>\s*span\s*\{[^}]*right:\s*100%/, "the last hour's name is still written to the right of its line");
  assert.match(css, /\.tl-tick\.last\s*\{[^}]*padding-left:\s*0/, "the last tick still carries the padding its name no longer needs");
  // And the ruler's own track clips. Turning the name round was not the whole of it:
  // an hour tick is a 1px border on the LEFT edge of a box at that hour, so a tick
  // standing on the day's last minute — which is every tick when the window ends on
  // the hour, as hers does — draws its line in the pixel AFTER the day. Measured live
  // at 375x812, that made the modules window 2461 pixels of scroll range against the
  // people's 2460: one pixel the second window cannot reach, which is exactly the
  // disagreement this test is about. With the clip both read 2460 and both pan to
  // 2139. Nothing visible is lost by it: no labelled tick's name is drawn past the
  // day — measured live, all 25 of them sit inside it, the last at 2259..2301 of a
  // 2304-pixel track.
  assert.match(css, /\.tl-ruler\s+\.tl-track\s*\{[^}]*overflow:\s*hidden/,
    "the ruler's track no longer clips, so a tick on the day's last minute can widen the modules' window past the people's");
  // The clip is on the ruler's track and NOT on the ruler itself: the ruler is the
  // sticky element, and clipping it would clip the name column pinned inside it.
  assert.doesNotMatch(css, /\.tl-ruler\s*\{[^}]*overflow:\s*hidden/,
    "the ruler itself is clipped, which would take the sticky name column with it");
});

// Her words, 23 September 2026, on the row that used to sit under the people: "im
// thinking of remove the people at once?", settled with "you can just show when
// there is overlapping highligt in red box, like previously have". So the row is
// gone, and the collision it used to count is still shown — in red, in three places
// that were already saying it.
test("the People at once row is gone, and a collision is still shown in red (v168)", () => {
  const { root } = render({ modules: collidingDay() });
  const people = paneOf(root, "people");

  // No tally row anywhere in the chart, and nothing built for one.
  assert.equal(walk(root).filter((n) => hasClass(n, "total-row")).length, 0,
    "the People at once row is still drawn under the people");
  assert.doesNotMatch(read("admin/js/views/scenario.js"), /totalRow/,
    "the tally row is still built, with nothing on the screen wearing it");
  assert.equal(textOf(people).includes("People at once"), false, "the people's window still names the row");
  // What is left in the people's window is the people themselves.
  assert.ok(personRows(people).length, "the people's window holds no person rows at all");

  // And the collision is still shown, in red, where it already was: the outline on
  // the colliding stretch of the person's own row.
  const clash = walk(people).filter((n) => hasClass(n, "tl-bar") && hasClass(n, "clash"));
  assert.ok(clash.length, "a colliding day no longer shows the collision in the people's window");
  assert.match(read("admin/css/app.css"), /\.tl-bar\.clash\s*\{[^}]*var\(--red\)/,
    "the red outline on a colliding stretch is gone from the stylesheet");
  // And the words under the diagram, which are the explanation a red outline cannot
  // give on a narrow bar.
  assert.match(textOf(root), /two jobs at once|collision/i, "the collisions are no longer written out anywhere on the screen");
});

// Her words, 23 September 2026, looking at the Your scenarios card: "why the deleted
// scenario stil listed?" Measured on a copy of her own data by deleting "My sister
// proposal 21/9/2026": the day left storage, and its name came straight back onto the
// card as "＋ My sister proposal 21/9/2026 · Mix by hand, no chiller" — in the place
// her saved row had just left and dressed exactly like the rows above it. The name of
// a day she has deleted may not stand where a saved day stands. That is the whole of
// her report, and this is the card it happened on.
test("a ready-made day she has deleted leaves no name standing on her card (v167)", () => {
  const scen = { ...ONE_BAKER_SCENARIO, modules: ONE_BAKER_SCENARIO.modules.map((m) => ({ ...m })) };
  const state = {
    settings: {
      currency: "RM", deliveryDays: [1, 3, 5], scenario: scen,
      scenarios: [
        { id: "s_mine", name: "No fridge, 1 person" },
        { id: ONE_BAKER_SCENARIO.id, name: ONE_BAKER_SCENARIO.name },
      ],
    },
    uoms: [], ingredients: [], products: [], orders: [], deliveryDates: [],
  };
  const root = createEl("div");
  renderScenario(root, state);

  const card = walk(root).find((n) => hasClass(n, "section") && /Your scenarios/.test(textOf(n))).parent;
  const text = textOf(card);
  assert.match(text, /No fridge, 1 person/, "her own saved day is not on the card");
  assert.match(text, /One baker day/, "her other saved day is not on the card");
  assert.doesNotMatch(text, /My sister proposal/,
    "a deleted day's name is still standing where her saved days stand");
  // One offer row, and it is the only row on the card that wears a ＋ at all — the
  // day she deleted must not be wearing one either.
  const plusRows = walk(card).filter((n) => hasClass(n, "info-row") && /＋/.test(textOf(n)));
  assert.equal(plusRows.length, 1,
    `${plusRows.length} rows begin with a ＋: ${plusRows.map(textOf).join(" | ")}`);

  // And nothing has been taken away from her: one row, naming none of them, which
  // opens the days she can add. A name inside a menu is an offer; a name on the shelf
  // is a listing, and that difference is the whole fix.
  const offer = walk(card).find((n) => hasClass(n, "info-row") && /Add a ready-made day/.test(textOf(n)));
  assert.ok(offer, "the ready-made days can no longer be added at all");

  layers["popup-layer"].replaceChildren();
  offer.dispatchEvent({ type: "click" });
  assert.match(popupBody(), /My sister proposal 21\/9\/2026/,
    "the menu does not offer the day she deleted, so it cannot be added back");
  assert.doesNotMatch(popupBody(), /No fridge, 1 person/,
    "the menu offers a day that is already on her shelf");
});

// ── Four days at a time on the shelf, the rest reached by sliding it (v174) ──
//
// Her words, 23 September 2026, on her eighth saved day: "now i had 8 scenario, we
// have to make the secenario just shown 4, the rest shown by slider". With no ceiling
// the card grew a row per day and the buttons under the shelf went off the bottom of
// her phone. The height is measured off the fourth row after the card is painted
// rather than multiplied out, because a long day's name wraps to a second line at
// 375px and the fourth row's foot is then not the first row's foot plus three.
test("the shelf shows four days and slides to the rest (v174)", () => {
  const css = read("admin/css/app.css");
  assert.match(css, /\.sc-shelf\s*\{[^}]*overflow-y:\s*auto/,
    "the shelf cannot slide, so the days past the fourth are unreachable");
  assert.match(css, /\.sc-shelf\s+thead\s+th\s*\{[^}]*position:\s*sticky/,
    "the shelf's headings scroll away from the rows they name");

  const six = ["A day", "B day", "C day", "D day", "E day", "F day"].map((name, i) => ({ id: `s${i}`, name }));

  const cardFor = (list) => {
    const state = {
      settings: {
        currency: "RM", deliveryDays: [1, 3, 5],
        scenario: { ...ONE_BAKER_SCENARIO, modules: ONE_BAKER_SCENARIO.modules.map((m) => ({ ...m })) },
        scenarios: list,
      },
      uoms: [], ingredients: [], products: [], orders: [], deliveryDates: [],
    };
    const root = createEl("div");
    renderScenario(root, state);
    const card = walk(root).find((n) => hasClass(n, "section") && /Your scenarios/.test(textOf(n))).parent;
    return { root, card, text: textOf(card) };
  };

  const many = boxes(() => cardFor(six));
  const shelf = walk(many.card).find((n) => hasClass(n, "sc-shelf"));
  assert.ok(shelf, "the shelf of days is not wrapped in anything that can be capped");
  assert.ok(walk(shelf).some((n) => hasClass(n, "sc-table")),
    "the shelf's own wrapper does not hold the table of days");

  const rows = walk(shelf).filter((n) => hasClass(n, "sc-row"));
  assert.equal(rows.length, 6, `the shelf drew ${rows.length} of her 6 days`);
  const cap = stylePx(shelf, "maxHeight");
  const foot = (r) => Math.round(r.getBoundingClientRect().bottom - shelf.getBoundingClientRect().top);
  assert.equal(cap, foot(rows[3]),
    `the shelf was capped at ${cap}px, which is not where the fourth day ends (${foot(rows[3])}px)`);
  assert.notEqual(cap, foot(rows[5]),
    "the shelf was capped off its last day rather than its fourth");

  // And a shelf that has stopped has to say so: on a phone no scrollbar is drawn
  // until the list is already moving, so the count is the only thing that can tell
  // her the list is longer than it looks.
  assert.match(many.text, /first 4 of your 6 days/,
    "the shelf stopped at four days without saying that the rest are there");

  // Four days or fewer: no height at all, no scroller under her thumb, no note.
  const few = boxes(() => cardFor(six.slice(0, 4)));
  const shelf4 = walk(few.card).find((n) => hasClass(n, "sc-shelf"));
  assert.ok(shelf4, "the shelf of days is not wrapped in anything");
  assert.equal(stylePx(shelf4, "maxHeight"), null,
    "a shelf that fits is given a height anyway, so a list with nothing to slide still catches her thumb");
  assert.doesNotMatch(few.text, /first \d+ of your/,
    "a shelf that fits claims days of hers are hidden");
  assert.match(few.text, /D day/, "the fourth day is not on the card at all");
});

// ── A repaint keeps what she is looking at where she left it (v175) ─────────
//
// Her words, 23 September 2026: "Few problem of screen jump here and there. One
// obvious one is the scenario windows, when i click, window reset." Every press that
// changes the day draws the screen again from scratch, and a node drawn again is a NEW
// node, which starts its own scroll at zero — so a press on a batch card threw both
// windows of the day back to the far left and the top, and would have thrown the shelf
// of days back to its first row with them.
test("a press that redraws the day leaves every window where she left it (v175)", () => {
  const six = ["A day", "B day", "C day", "D day", "E day", "F day"].map((name, i) => ({ id: `s${i}`, name }));
  const state = {
    settings: {
      currency: "RM", deliveryDays: [1, 3, 5],
      scenario: { ...ONE_BAKER_SCENARIO, modules: ONE_BAKER_SCENARIO.modules.map((m) => ({ ...m })) },
      scenarios: six,
    },
    uoms: [], ingredients: [], products: [], orders: [], deliveryDates: [],
  };
  const root = createEl("div");
  renderScenario(root, state);
  const [proc0, people0] = giveThemAWindow(root);
  const shelf0 = walk(root).find((n) => hasClass(n, "sc-shelf"));
  assert.ok(shelf0, "the shelf of days is not on the screen, so nothing here can be measured about it");

  // Panned differently on purpose, so one number written to both windows cannot pass:
  // the two windows are kept apart by their own positions.
  proc0.scrollLeft = 300; proc0.scrollTop = 120;
  people0.scrollLeft = 260; people0.scrollTop = 40;
  shelf0.scrollTop = 90;

  // The press that redraws everything: a button on a batch card.
  tapBar(root, "Cutting and packing", 0);
  popupButton(/\+ 5 min/).dispatchEvent({ type: "click" });

  const proc = paneOf(root, "proc");
  const people = paneOf(root, "people");
  const shelf = walk(root).find((n) => hasClass(n, "sc-shelf"));
  assert.notEqual(proc, proc0, "the press did not redraw the chart, so it proves nothing about a redraw");
  assert.equal(proc.scrollLeft, 300, "the press threw the modules' window back to the start of the day");
  assert.equal(proc.scrollTop, 120, "the press threw the modules' window back to the top");
  assert.equal(people.scrollLeft, 260, "the press threw the people's window back to the start of the day");
  assert.equal(people.scrollTop, 40, "the press threw the people's window back to the top");
  assert.equal(shelf.scrollTop, 90, "the press threw the shelf of days back to its first row");

  // And a window she never touched is left at its own start rather than given another
  // window's number: the restore puts back what was there, it does not impose one
  // position on both.
  const fresh = render();
  const [fp] = giveThemAWindow(fresh.root);
  assert.equal(fp.scrollLeft, 0, "a window she never panned is not at the start of the day");
});

// And the shelf's own height has to be taken before it is put back where she left it.
// Its cap is measured off the fourth row's foot, and a row's foot moves when the list
// under it slides — so a cap measured with the list already slid down would come out
// short by exactly the amount it was slid, and the fourth day would be cut in half.
// The shelf is measured while it is still at its own top, which a box just drawn
// always is, and only then is she put back where she was.
test("a repaint leaves the shelf where she left it and still measures it at its own top (v175)", () => {
  const six = ["A day", "B day", "C day", "D day", "E day", "F day"].map((name, i) => ({ id: `s${i}`, name }));
  const state = {
    settings: {
      currency: "RM", deliveryDays: [1, 3, 5],
      scenario: { ...ONE_BAKER_SCENARIO, modules: ONE_BAKER_SCENARIO.modules.map((m) => ({ ...m })) },
      scenarios: six,
    },
    uoms: [], ingredients: [], products: [], orders: [], deliveryDates: [],
  };
  const shelved = (scroll) => boxes(() => {
    const root = createEl("div");
    renderScenario(root, state);
    const before = walk(root).find((n) => hasClass(n, "sc-shelf"));
    if (scroll) before.scrollTop = scroll;
    // The press that redraws the whole screen, and the shelf with it.
    tapBar(root, "Cutting and packing", 0);
    popupButton(/\+ 5 min/).dispatchEvent({ type: "click" });
    const shelf = walk(root).find((n) => hasClass(n, "sc-shelf"));
    return {
      shelf,
      rows: walk(shelf).filter((n) => hasClass(n, "sc-row")),
      cap: stylePx(shelf, "maxHeight"),
    };
  });

  const atTop = shelved(0);
  const slid = shelved(90);
  assert.notEqual(slid.shelf, atTop.shelf, "the press did not redraw the shelf, so it proves nothing about a redraw");
  assert.equal(atTop.cap, Math.round(atTop.rows[3].getBoundingClientRect().bottom - atTop.shelf.getBoundingClientRect().top),
    "the shelf is not capped at its fourth day's foot to begin with");
  assert.equal(slid.shelf.scrollTop, 90, "the press threw the shelf of days back to its first row");
  assert.equal(slid.cap, atTop.cap,
    `the shelf was capped at ${slid.cap}px with the list slid down against ${atTop.cap}px at its top, so the height followed where the list happened to be and the fourth day is cut`);
});

test("a right press pans the day with a card open over it (v175)", () => {
  const { root } = render();
  const [proc, people] = giveThemAWindow(root);
  // The two windows' own boxes, one above the other as they are drawn, so which window
  // a press belongs to is decided by where her hand is. The shim's one constant box for
  // every node cannot tell them apart.
  proc._rect = { left: 0, top: 0, width: 375, height: 300 };
  people._rect = { left: 0, top: 300, width: 375, height: 120 };
  proc.scrollLeft = 200; people.scrollLeft = 200;

  // A card open over the chart, which is her case: the day she is looking at is behind
  // the card she opened on it.
  tapBar(root, "Cutting and packing", 0);
  assert.ok(popupBody(), "no card is open, so there is nothing over the chart to press through");
  const layer = layers["popup-layer"];

  layer.dispatchEvent({ type: "pointerdown", button: 2, buttons: 2, clientX: 200, clientY: 100, pointerId: 11 });
  layer.dispatchEvent({ type: "pointermove", button: 2, buttons: 2, clientX: 140, clientY: 80, pointerId: 11 });
  assert.equal(proc.scrollLeft, 260, "a right press over an open card did not move the day behind it");
  assert.equal(proc.scrollTop, 20, "a right press over an open card did not move the day behind it");
  layer.dispatchEvent({ type: "pointerup", button: 2, clientX: 140, clientY: 80, pointerId: 11 });
  assert.ok(!proc.classList.contains("tl-dragging"), "the window still says it is being dragged after she let go");

  // The lower press belongs to the lower window, worked out from where her hand is.
  layer.dispatchEvent({ type: "pointerdown", button: 2, buttons: 2, clientX: 200, clientY: 350, pointerId: 12 });
  layer.dispatchEvent({ type: "pointermove", button: 2, buttons: 2, clientX: 160, clientY: 350, pointerId: 12 });
  assert.equal(people.scrollLeft, 240, "a right press below the modules' window did not move the people's window");
  assert.equal(proc.scrollLeft, 260, "a press on the people's window moved the modules' one as well");
  layer.dispatchEvent({ type: "pointerup", button: 2, clientX: 160, clientY: 350, pointerId: 12 });

  // Her own card is not the pan. A right press on the card — or on anything inside it,
  // which is where a real press lands — is left alone, or the day would slide about
  // while she is reading the card that describes it.
  const card = walk(layer).find((n) => hasClass(n, "popup-card"));
  assert.ok(card, "the card is not marked as the card, so nothing can tell it from the sheet behind it");
  layer.dispatchEvent({ type: "pointerdown", button: 2, buttons: 2, clientX: 200, clientY: 100, pointerId: 13, target: card });
  layer.dispatchEvent({ type: "pointermove", button: 2, buttons: 2, clientX: 150, clientY: 100, pointerId: 13, target: card });
  assert.equal(proc.scrollLeft, 260, "a right press on her own card dragged the day behind it");

  // And the LEFT button is still the press that opens and works cards, never the pan.
  layer.dispatchEvent({ type: "pointerdown", button: 0, buttons: 1, clientX: 200, clientY: 100, pointerId: 14 });
  layer.dispatchEvent({ type: "pointermove", button: 0, buttons: 1, clientX: 150, clientY: 100, pointerId: 14 });
  assert.equal(proc.scrollLeft, 260, "a left press on the card's sheet panned the day");

  // And the menu that a right press would otherwise raise over her card does not.
  const ev = { type: "contextmenu", button: 2 };
  layer.dispatchEvent(ev);
  assert.ok(ev.defaultPrevented, "the browser's own menu still opens over the card");
});

test("both windows read the ruler from one pair of numbers, set once (v167)", () => {
  const { root } = render();
  const wrap = wrapOf(root);
  // The numbers the chart itself wrote, rather than recomputed — so the test cannot
  // agree with a rule the screen does not use.
  assert.equal(px(wrap, "--hour-w"), Math.round(60 * ONE_BAKER_SCENARIO.pxPerMin),
    "the hour line is not set on the element both windows inherit from");
  for (const p of [paneOf(root, "proc"), paneOf(root, "people")]) {
    assert.equal(px(p, "--hour-w"), null, "a window sets its own hour width, so the two can drift apart");
    assert.equal(px(p, "--tick-w"), null, "a window sets its own grid step, so its ruling can disagree with the ruler's");
  }
  // And the stylesheet never declares either: they are the screen's own numbers,
  // and a declaration here would be a second answer to the same question — the
  // whole point of the v160 grid being that the lines and the ruler cannot disagree
  // about where a minute is.
  const css = read("admin/css/app.css");
  assert.doesNotMatch(css, /--hour-w\s*:/, "the stylesheet declares the hour width as well as the screen");
  assert.doesNotMatch(css, /--tick-w\s*:/, "the stylesheet declares the grid step as well as the screen");
});

test("the two windows share the chart's ceiling, with the modules given the larger half (v168)", () => {
  const css = read("admin/css/app.css");
  const caps = {};
  for (const which of ["proc", "people"]) {
    const rule = new RegExp(`\\.tl-pane-${which}\\s*\\{[^}]*\\}`).exec(css);
    assert.ok(rule, `the ${which} window has no rule of its own`);
    const m = /max-height:\s*min\(\s*(\d+(?:\.\d+)?)vh\s*,\s*(\d+(?:\.\d+)?)px\s*\)/.exec(rule[0]);
    assert.ok(m, `the ${which} window's cap is not a vh/px pair, so its share of the budget cannot be read`);
    caps[which] = { vh: Number(m[1]), px: Number(m[2]) };
  }
  // The ceilng the chart has always had, and the split she asked for. Her words, 23
  // September 2026, after the two windows shipped: "can you increase the modulle
  // window further?" So the modules hold 64vh of the 84 where they held 50vh of the
  // 80, and the people hold 20vh where they held 28. The slider between them is gone
  // in this release — "since the both windows have their own slider, additional
  // slider is redundent. Remove that" — so it takes no share of the budget any more,
  // and the heights it used to sit in are the modules'.
  assert.equal(caps.proc.vh, 64, `the modules window asks for ${caps.proc.vh}vh, not the 64 she was given`);
  assert.equal(caps.people.vh, 20, `the people's window asks for ${caps.people.vh}vh, not the 20 that leaves the rest to the modules`);
  // The invariant a future edit must not break, written as the sum rather than as
  // the numbers, because the numbers are exactly what a future edit may move: 84vh /
  // 780px is the tallest this chart is ever drawn, and the two windows together must
  // not ask for more, or the chart grows taller than it has ever been on her phone.
  assert.equal(caps.proc.vh + caps.people.vh, 84,
    `the two windows ask for ${caps.proc.vh + caps.people.vh}vh, not the 84vh the chart is allowed`);
  assert.equal(caps.proc.px + caps.people.px, 780,
    `the two windows ask for ${caps.proc.px + caps.people.px}px, not the 780px the chart is allowed`);
  // And there is no slider left holding a share: nothing in the stylesheet styles one.
  assert.doesNotMatch(css, /\.tl-slider/, "a rule for the shared slider is still in the stylesheet");
});

test("the two windows' name columns are one rule, so their axes cannot drift (v167)", () => {
  const css = read("admin/css/app.css");
  // Every rule that names the column, with its own selector — the column has
  // contextual overrides (a person's row tints it), so it is the WIDTH that has to
  // be declared once rather than the selector that has to appear once.
  const nameRules = [...css.matchAll(/[^{}]*\.tl-name(?![\w-])[^{}]*\{[^}]*\}/g)].map((m) => m[0]);
  assert.ok(nameRules.length >= 1, "the name column has no rule at all");
  const sized = nameRules.filter((r) => /156px/.test(r));
  assert.equal(sized.length, 1, `the name column's width is declared in ${sized.length} places, so the two windows can size it differently`);
  // Both halves — a basis and a width — because a column that is one in the modules
  // and the other among the people is exactly the drift this test is for.
  assert.equal((sized[0].match(/156px/g) || []).length, 2,
    "the name column's width is not declared as both a flex basis and a width, so it can size differently in the two windows");
  // And no rule gives one window a name column of its own: the same pixel has to be
  // the same minute on both sides of the slider, and that 156px is what makes the
  // chart's ONE hairline computation correct in either window.
  const scoped = nameRules.filter((r) => /\.tl-pane-/.test(r.slice(0, r.indexOf("{"))));
  assert.equal(scoped.length, 0, `a window overrides the name column: ${scoped.map((r) => r.slice(0, r.indexOf("{")).trim()).join(" / ")}`);
});

// ── v172: the question a card asks is drawn over the card that asked it ─────
//
// Her report of 23 September 2026: "please check the process of delete a module
// and the process of deleting a scenario, it dont look right". It did not look
// right because it could not be looked at. Both of those questions are asked FROM
// the card they are about, and the card stays on the screen behind the question —
// deliberately, so she can see which module she is about to lose. What was wrong
// was the order the two were drawn in: the layer the question goes on sat under
// the layer of the card. Measured on her own day at 375px, every point of the
// confirm's own box belonged to the card — an input at the Delete button's centre,
// a label at the card's own centre — so the sentence could not be read, neither
// button could be pressed, and the only thing she saw was the screen dimming a
// second time with nothing appearing. Both flows were the same fault.
test("the question a card asks is drawn over the card that asked it (v172)", () => {
  const css = read("admin/css/app.css");
  const zOf = (cls) => {
    const rule = new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`).exec(css);
    assert.ok(rule, `.${cls} has no rule of its own, so nothing places it`);
    const m = /z-index:\s*(\d+)/.exec(rule[0]);
    assert.ok(m, `.${cls} declares no z-index, so where it sits is its luck in the file`);
    return Number(m[1]);
  };
  assert.ok(zOf("confirm-layer") > zOf("popup-layer"),
    `the question is drawn at ${zOf("confirm-layer")}, under the card that asked it at ${zOf("popup-layer")}, so it can be neither read nor answered`);
  // And only the app-password lock outranks it: that is the one thing she must
  // answer before any card or question of this app exists at all.
  assert.ok(zOf("confirm-layer") < zOf("lock-layer"),
    "the question is drawn over the app-password lock");

  // The question itself. It names the module in quotes, as every other delete in
  // the app names what it is about; unquoted, a name opening on a capital read as
  // one sentence with the name lost inside it — "Delete The proofer again?".
  const { root, state } = render();
  const ask = () => {
    openModule(root, "Cutting and packing");
    popupButton(/Delete this module/).dispatchEvent({ type: "click" });
  };
  const answers = () => walk(layers["confirm-layer"]).filter((n) => n.tagName === "BUTTON");
  ask();
  const asked = textOf(layers["confirm-layer"]);
  assert.match(asked, /Delete the module "Cutting and packing"\?/,
    `the question does not name the module in quotes: ${asked.trim()}`);
  assert.deepEqual(answers().map((b) => textOf(b).trim()), ["Cancel", "Delete"],
    "the question is not answered by the safe button and then the destructive one");

  // Cancel means cancel, and the card she asked from stays where it was.
  answers()[0].dispatchEvent({ type: "click" });
  assert.equal(walk(layers["confirm-layer"]).length, 0, "Cancel left the question standing on the screen");
  assert.ok(state.settings.scenario.modules.some((m) => m.name === "Cutting and packing"),
    "Cancel deleted the module");
  assert.ok(popupButton(/Delete this module/), "Cancel closed the card the question was asked from");

  // And Delete does what it says, and takes the card with it.
  ask();
  answers()[1].dispatchEvent({ type: "click" });
  assert.ok(!state.settings.scenario.modules.some((m) => m.name === "Cutting and packing"),
    "Delete left the module on the day");
  assert.equal(layers["popup-layer"].hidden, true, "the card stayed open after the module went");
});

// ── v172: every card's foot of buttons is one row, with air between them ────
//
// The same report, the other half of it. `.popup-actions` is used in 26 places and
// never had a rule of its own, so its buttons flowed as inline-blocks: flush against
// each other and hard against the left edge of the card. Measured on the module card
// at 375px, "Delete this module" and "Done" were 0 pixels apart — a thumb reaching
// for Done was touching the button that deletes the module — with 88 pixels of dead
// card to their right, and the scenario card stacked its destructive button directly
// above its safe one at the same left edge.
test("every card's foot of buttons is one row, with air between them (v172)", () => {
  const css = read("admin/css/app.css");
  const rules = [...css.matchAll(/(^|\n)([^{}\n]*\.popup-actions[^{}\n]*)\{([^}]*)\}/g)]
    .map((m) => ({ sel: m[2].trim(), body: m[3] }));
  const bare = rules.filter((r) => r.sel === ".popup-actions");
  assert.equal(bare.length, 1,
    `the foot row is declared ${bare.length} times, so one card's row can be tuned apart from another's`);
  const { body } = bare[0];
  assert.match(body, /display:\s*flex/,
    "the foot row's buttons flow as inline blocks, so nothing holds them apart");
  assert.match(body, /gap:\s*8px/,
    "the foot row has no gap, so a destructive button sits flush against the one beside it");
  assert.match(body, /justify-content:\s*flex-end/,
    "the foot row is not laid out against the card's own edge");
  // wrap is not decoration. The module's three buttons need 437 pixels and have 303,
  // and a row too wide for its card must go onto a second line rather than off it.
  assert.match(body, /flex-wrap:\s*wrap/,
    "a foot row too wide for its card cannot wrap, so its buttons run off the card's edge");

  // One answer, in one place. Three cards had patched the spacing in by hand, each a
  // little differently — two with their own display:flex and a gap, one with a margin
  // of its own — which is a second and a third answer to a question this rule answers.
  const jsFiles = [];
  (function collect(dir) {
    for (const entry of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) collect(`${path}/`);
      else if (entry.name.endsWith(".js")) jsFiles.push(path);
    }
  })("admin/js/");
  const patched = jsFiles.filter((f) => /class: "popup-actions",\s*style:/.test(read(f)));
  assert.deepEqual(patched, [], `a card lays its own foot row out by hand: ${patched.join(", ")}`);

  // And the module card's foot is that row, carrying its three buttons in order.
  const { root } = render();
  openModule(root, "Cutting and packing");
  const foot = walk(layers["popup-layer"]).find((n) => hasClass(n, "popup-actions")
    && walk(n).some((c) => c.tagName === "BUTTON" && /^Done$/.test(textOf(c).trim())));
  assert.ok(foot, "the module card's foot of buttons is not the row the stylesheet shapes");
  assert.deepEqual(walk(foot).filter((n) => n.tagName === "BUTTON").map((b) => textOf(b).trim()),
    ["Duplicate this module", "Delete this module", "Done"],
    "the module card's foot does not carry its three buttons");
});

// ── Each person's hours, and what each of them is trained for (v177) ─────────
//
// Her words, 23 September 2026: "I need each person to have the start work time and
// end work time" and "which module they are dedicated for" — which she then resolved
// herself into a statement about TRAINING rather than a rank: "a person we should be
// able to specify their skill, by module, can be more then one, by module" and
// "module should select the one that specialised".
//
// The model's own rules — who a free job is offered to, and what absence means — are
// pinned in test/scenario.test.js. This block is about the SCREEN: what is drawn,
// what a press writes, and the one that would be silent if it broke — that opening a
// day never inherits the hours of the day she was on before.

// The person row for `name`, opened the way she opens it: a tap on the row.
function openPerson(root, name) {
  const row = walk(root).find((n) => hasClass(n, "tl-row") && hasClass(n, "person")
    && hasClass(n, "tappable") && textOf(n).includes(name));
  assert.ok(row, `no person row named ${name}`);
  row.dispatchEvent({ type: "click" });
  return row;
}
// The two hour boxes on the card, in the order the card draws them.
const hourBoxes = () => walk(layers["popup-layer"])
  .filter((n) => n.tagName === "INPUT" && n.attrs.type === "time");
// A ticked/unticked box inside the row whose text names `label`.
const tickFor = (label) => {
  const row = walk(layers["popup-layer"]).find((n) => hasClass(n, "row-check") && textOf(n).includes(label));
  return row && walk(row).find((n) => n.tagName === "INPUT" && n.attrs.type === "checkbox");
};

test("a person's hours are drawn on their row, under everything the day draws (v177)", () => {
  const css = read("admin/css/app.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const mine = rules.filter((b) => /(^|[\s>+~])\.tl-shift$/.test(b.sel));
  assert.equal(mine.length, 1, `expected one rule for the hours band, found ${mine.length}`);
  assert.match(mine[0].body, /position:\s*absolute/,
    "the band is not positioned, so it cannot sit at its own minute of the day");
  // The v174 fault in a new coat, and the reason this gets an assertion of its own:
  // the chart's painting order is a three-rung ladder on the wrap and that test
  // enumerates three named classes, so a z-index added to a NEW class is invisible to
  // it. A positioned element given one creates a stacking context, which is exactly
  // how the day's writing climbed over the pinned module titles.
  assert.doesNotMatch(mine[0].body, /z-index/,
    "the band carries a z-index, which creates a stacking context inside the track — the v174 fault, back again");
  assert.match(mine[0].body, /pointer-events:\s*none/,
    "the band takes pointer events, so it can swallow a tap meant for the stretch over it");

  const { root } = render({ shifts: { 1: { startMin: 60, endMin: 300 } } });
  const row = walk(root).find((n) => hasClass(n, "tl-row") && hasClass(n, "person") && textOf(n).includes("Person 1"));
  assert.ok(row, "there is no person row on the day");
  const track = walk(row).find((n) => hasClass(n, "tl-track"));
  const band = walk(track).find((n) => hasClass(n, "tl-shift"));
  assert.ok(band, "somebody with hours set has no band on their row");
  assert.equal(track.children.filter((c) => c.nodeType === 1)[0], band,
    "the band is not drawn first inside the track, so the day's bars would go under it instead of over it");
  // The bars' own arithmetic: a minute of the day is pxPerMin pixels from the start,
  // and the band is nothing but the two ends of the shift drawn the same way.
  const scale = ONE_BAKER_SCENARIO.pxPerMin;
  assert.equal(px(band, "left"), Math.round(60 * scale),
    "the band does not begin at the minute the person arrives");
  assert.equal(px(band, "width"), Math.round(240 * scale),
    "the band is not as wide as the hours it stands for");

  // And no hours set is no band at all — the drawn screen of every day built before
  // this existed, to the pixel.
  const plain = render();
  assert.equal(walk(plain.root).filter((n) => hasClass(n, "tl-shift")).length, 0,
    "a day with no hours set draws a band anyway");
});

// Every band drawn on one person's row, found by its class inside that person's own
// track, never across the whole screen, so a test about one worker's band cannot be
// answered by another worker's. A COUNT is what gets compared and never a node, and
// that is not a style preference: a failing assertion hands both its sides to node's
// own formatter with `showHidden: true`, and every own property of a shim node is
// walked, `parent` included, so the walk goes back up the tree it has just come down.
// Measured, not guessed — one node handed to an assertion came out at 135,447,648
// characters and took longer than the run was allowed, so the test read as a hang
// instead of as a failure. A test that can only hang is a test that cannot fail, which
// is the one thing this file exists to refuse.
const bandsOn = (root, name) => {
  const row = walk(root).find((n) => hasClass(n, "tl-row") && hasClass(n, "person") && textOf(n).includes(name));
  assert.ok(row, `no person row named ${name}`);
  const track = walk(row).find((n) => hasClass(n, "tl-track"));
  return walk(track).filter((n) => hasClass(n, "tl-shift") || hasClass(n, "tl-work")).length;
};
const trackOf1 = (root, name) => {
  const row = walk(root).find((n) => hasClass(n, "tl-row") && hasClass(n, "person") && textOf(n).includes(name));
  assert.ok(row, `no person row named ${name}`);
  return walk(row).find((n) => hasClass(n, "tl-track"));
};

test("the only band on a person's row is the hours she typed, worked out from nowhere (v182)", () => {
  // Her word of 24 September, retiring the computed shade outright: "Wei should not have
  // any shade because there is no work time set for him, shade should just follow what i
  // set, not other consideration." So the shaded stretch v179 drew from the day — and
  // v180 stood down where hours were typed — is gone from the screen, the stylesheet and
  // the model, and `tl-work` is a class this app no longer has.
  const css = read("admin/css/app.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const computed = rules.filter((b) => /(^|[\s>+~])\.tl-work$/.test(b.sel));
  assert.equal(computed.length, 0,
    "a rule for the computed shade is still in the stylesheet, so the band she retired can still be drawn");
  assert.equal(rules.filter((b) => /\.tl-shift$/.test(b.sel)).length, 1,
    "the hours band's one rule is gone, so a person she HAS typed hours for has no band either");

  // A day with nobody's hours typed — every day she has ever built — draws no band at
  // all on a person's row. Measured on her own day before this: Wei wore a band 93
  // minutes wide, 4:00 am to 5:33 am, for five jobs totalling eleven minutes, against a
  // whole day whose hands come to 58.
  const { root } = render();
  const row = walk(root).find((n) => hasClass(n, "tl-row") && hasClass(n, "person") && textOf(n).includes("Person 1"));
  assert.equal(walk(root).filter((n) => hasClass(n, "tl-work")).length, 0,
    "the computed shade is still drawn somewhere on the day");
  assert.equal(bandsOn(root, "Person 1"), 0,
    "a person nobody has set hours for still wears a band, so the row is shaded by a rule of the app rather than by her");
  assert.ok(walk(trackOf1(root, "Person 1")).filter((n) => hasClass(n, "tl-bar")).length > 0,
    "the day's own jobs left the row as well");
  assert.doesNotMatch(textOf(row), /Working/,
    "the row still says the working stretch in words, so the band went and the claim it made stayed");

  // Nor is it on the card, where she read the two contradictory numbers side by side:
  // "11 min of work, in 3 places, and nothing collides.Here all day.Working 4:00 am →
  // 5:33 am." What is left is her own answer, and the day's own count.
  openPerson(root, "Person 1");
  assert.doesNotMatch(popupBody(), /Working/,
    "the person's card still says Working … about a stretch no band stands for");
  assert.match(popupBody(), /min of work/,
    "the card lost the day's own count of the minutes this person works");
  assert.match(popupBody(), /Here all day/,
    "the card lost the answer to when this person is here, which is the one of the two she set herself");

  // And where she HAS typed hours, exactly one band is drawn — hers — and it is still
  // first in the track so the day's bars sit over it. The words for it are hers too:
  // "Here 5:00 am → 6:00 am".
  const typed = render({ shifts: { 1: { startMin: 60, endMin: 300 } } });
  assert.equal(bandsOn(typed.root, "Person 1"), 1,
    "somebody with hours typed has no band, or has two bands again");
  const typedTrack = trackOf1(typed.root, "Person 1");
  const band = walk(typedTrack).find((n) => hasClass(n, "tl-shift"));
  assert.equal(typedTrack.children.filter((c) => c.nodeType === 1)[0], band,
    "the hours band is not first in the track, so the day's bars would go under it instead of over it");
  const scale = ONE_BAKER_SCENARIO.pxPerMin;
  assert.equal(px(band, "left"), Math.round(60 * scale),
    "the band does not begin at the minute she typed this person in at");
  assert.equal(px(band, "width"), Math.round(240 * scale),
    "the band is not as long as the hours she typed");
  openPerson(typed.root, "Person 1");
  assert.match(popupBody(), /Here \d{1,2}:\d{2} (am|pm) → \d{1,2}:\d{2} (am|pm)/,
    "the card lost the hours she typed herself, which are the only ones left to show");
  assert.doesNotMatch(popupBody(), /Working/,
    "the card still carries the computed line beside her own hours");
});

// ── Reassignment is automatic, and the card says so (v183) ───────────────────
//
// Her words, 24 September 2026, having gone looking for a reassign button on this
// card: "if you know that reassignment is automatic, then forget about my request for
// reassignment button, just need to mention work reassignment is automatic with worker
// card detail change". So there is no button, and the card carries the sentence
// instead. A card that SAID that and did not do it would be worse than saying
// nothing, so both halves are pinned: the words, and the movement they promise —
// measured on a two-hand day, where one tick on this card takes a job off this
// person's own list and puts it on somebody else's, with nothing pressed but the tick.

test("the person's card says reassignment is automatic, and shows it happening (v183)", () => {
  const { root } = render();
  openPerson(root, "Person 1");
  assert.match(popupBody(), /reassign button/,
    "the card says nothing about the reassign button she went looking for");
  assert.match(popupBody(), /the day gives out this work by itself/,
    "the card does not say that the day hands its own work out");
  assert.match(popupBody(), /What you placed by hand stays yours/,
    "the card does not say which placements it will not move");
  // And the sentence must not be doing the work of a control: no press on this card
  // moves a job. What moves one is her hand — on this card, a tick; on somebody's own
  // row, that stretch itself. The close ✕ and Done are the only buttons a card carries.
  const named = walk(layers["popup-layer"]).filter((n) => n.tagName === "BUTTON")
    .map((b) => textOf(b).trim()).filter((t) => /reassign|move|hand|share|assign/i.test(t));
  assert.deepEqual(named, [],
    "the card has grown a press about the work after all, which is the button she withdrew");

  // The promise, measured. Two modules, two pairs of hands: one module names its
  // people, the other is given out by the day. With nobody trained the free job falls
  // to person 1 — the lower number, and both of them able to work anything, so equal.
  // Train person 1 for the NAMED module and nothing else, and that free job is no
  // longer theirs to have.
  const two = render({
    modules: [
      { id: "named_mod", name: "The named one", on: true, batch: 1, people: 1,
        count: 2, crew: [1, 2], repeats: 2, everyMin: 20, cycleMin: 5, touchMin: 5, startMin: 0 },
      { id: "free_mod", name: "The free one", on: true, batch: 1, people: 1,
        repeats: 1, everyMin: 0, cycleMin: 5, touchMin: 5, startMin: 60 },
    ],
  });
  // Read off the job lines the card itself draws, never off the model, so a card that
  // promised a move and drew the old list would fail here rather than pass. Each line
  // reads "4:00 am — The free one" and, where a module runs more than one, names its
  // line too — this test is about WHICH module is on the list, so the name is read out
  // of that line rather than the line compared whole.
  const jobLines = () => walk(layers["popup-layer"])
    .filter((n) => hasClass(n, "tl-note-job"))
    .map((n) => textOf(n).trim().replace(/^\d{1,2}:\d{2} (am|pm) — /, "").replace(/, line \d+$/, "").trim());
  openPerson(two.root, "Person 1");
  assert.deepEqual(jobLines(), ["The named one", "The free one"],
    "the day did not hand the free job to person 1 to begin with, so this card has nothing to show moving");
  const tick = tickFor("The named one");
  assert.ok(tick, "the card offers no way to train person 1 for the named module");
  tick.checked = true;
  tick.dispatchEvent({ type: "change" });
  assert.deepEqual(two.state.settings.scenario.skills, { 1: ["named_mod"] },
    "ticking the module did not write the training the day works from");
  // The day's own answer first, and the card's after it, because this claim can break
  // at either end and the two are worth telling apart: a day that ignored the tick is
  // the rule itself giving way, where a card that went on drawing the day it was built
  // from is only a stale card. Asked in this order, each fault fails the assertion that
  // names it rather than both landing on the card's.
  const dayAt = (who) => (computeScenario(two.state.settings.scenario).rows.find((r) => r.person === who) || {}).items.map((i) => i.module);
  assert.deepEqual(dayAt(1), ["named_mod"],
    "the day itself went on giving the free job to somebody trained for something else");
  assert.deepEqual(dayAt(2), ["named_mod", "free_mod"],
    "the day took the free job off person 1 and gave it to nobody");
  assert.deepEqual(jobLines(), ["The named one"],
    "the card went on drawing the day it was built from — the promise of automatic reassignment is a sentence and nothing more");
  // And it went somewhere rather than nowhere: the other person's own card now wears it.
  openPerson(two.root, "Person 2");
  assert.deepEqual(jobLines(), ["The named one", "The free one"],
    "the job left person 1 and arrived on nobody, so the day lost a job rather than reassigning it");

  // Untick, and the day puts it back to the job — the same card, the same way.
  openPerson(two.root, "Person 1");
  const back = tickFor("The named one");
  back.checked = false;
  back.dispatchEvent({ type: "change" });
  assert.deepEqual(two.state.settings.scenario.skills, {},
    "unticking everything left an entry behind where the day reads here-all-day-can-work-anything");
  assert.deepEqual(jobLines(), ["The named one", "The free one"],
    "the free job did not come back to person 1 when the training was taken off");
});

test("a job too short to see is still drawn four wide (v182)", () => {
  // The thumb rule this app keeps, pinned here so that removing the band could not
  // quietly take the four-pixel floor with it: a one-minute job is drawn four wide, so
  // it can be seen and tapped. Twelve folds of one minute each, so the whole row is
  // jobs the floor is holding open, and the row still carries no band of its own.
  const fold = ONE_BAKER_SCENARIO.modules.find((m) => m.id === "solo_fold");
  const { root } = render({ modules: [{ ...fold, cycles: (fold.cycles || []).map((c) => ({ ...c })) }] });
  const track = trackOf1(root, "Person 1");
  const bars = walk(track).filter((n) => hasClass(n, "tl-bar"));
  assert.equal(bars.length, 12, `the day drew ${bars.length} jobs where the fold runs twelve`);
  for (const b of bars) {
    assert.equal(px(b, "width"), 4, "a one-minute job was drawn narrower than the four-pixel floor");
  }
  const lastBar = bars[bars.length - 1];
  assert.equal(px(lastBar, "left") + px(lastBar, "width"), 602,
    "the last one-minute job is not where its own minute and the floor put it");
  assert.equal(bandsOn(root, "Person 1"), 0,
    "a row of short jobs was given a band of its own");
});

test("the two hour boxes read as clock times and store minutes from her day's start (v177)", () => {
  const { root, state } = render({ dayStartMin: 240, shifts: { 1: { startMin: 60, endMin: 300 } } });
  openPerson(root, "Person 1");
  const boxes = hourBoxes();
  assert.equal(boxes.length, 2, `the person card offers ${boxes.length} hour boxes, not two`);
  // Her day starts at 4:00 am, so minute 60 IS 5:00 am and minute 300 IS 9:00 am.
  assert.equal(boxes[0].value, "05:00", `the card shows "${boxes[0].value}" where the person arrives at 5:00 am`);
  assert.equal(boxes[1].value, "09:00", `the card shows "${boxes[1].value}" where the person leaves at 9:00 am`);

  boxes[1].value = "07:00";   // 7:00 am, which is minute 180 of her 4:00 am day
  boxes[1].dispatchEvent({ type: "input" });
  assert.deepEqual(state.settings.scenario.shifts["1"], { startMin: 60, endMin: 180 },
    "the box was stored as a clock reading and not as minutes from the start of her day");
  assert.equal(boxes[0].value, "05:00", "changing when they leave moved when they arrive");

  // A pair the wrong way round is refused and SAID. A box that takes a number and
  // quietly does something else with it is a box that reads as broken for weeks.
  boxes[0].value = "10:00";
  boxes[0].dispatchEvent({ type: "input" });
  assert.deepEqual(state.settings.scenario.shifts["1"], { startMin: 60, endMin: 180 },
    "a back-to-front pair was written to the day anyway");
  assert.match(popupBody(), /wrong way round/, "a refused pair is refused silently");
  assert.equal(boxes[0].value, "05:00", "the box kept a time the day is not using");

  // And clearing both is a real answer: here all day, which the store spells as no
  // entry at all — the same absence every day before this one already has.
  for (const b of [boxes[0], boxes[1]]) {
    b.value = "";
    b.dispatchEvent({ type: "input" });
  }
  assert.deepEqual(state.settings.scenario.shifts, {},
    "clearing both boxes left hours behind instead of putting the person back to here all day");
});

test("a tick says what somebody is trained for, and unticking everything is a real answer (v177)", () => {
  const { root, state } = render();
  openPerson(root, "Person 1");
  // Only the modules that actually hold hands are offered. The proofer is on this day
  // and takes none, so a tick against it would be a tap that does nothing.
  assert.ok(!tickFor("Into the proofer"),
    "the card offers training for a module that never takes hands, so the tick does nothing");
  const mix = tickFor("Mixing the dough in the tub");
  assert.ok(mix, "the card offers no way to say what somebody is trained for");

  mix.checked = true;
  mix.dispatchEvent({ type: "change" });
  assert.deepEqual(state.settings.scenario.skills, { 1: ["solo_mix"] },
    "ticking a module did not write the training the day works from");

  const oven = tickFor("The oven swap and the bake");
  oven.checked = true;
  oven.dispatchEvent({ type: "change" });
  assert.deepEqual(state.settings.scenario.skills, { 1: ["solo_mix", "solo_oven"] },
    "a second tick replaced the first instead of being added to it");

  // Untick everything: "can work anything", which is what every day before this one
  // says — so the entry is DELETED and not left as an empty list, the same one
  // spelling of unset the hours follow.
  for (const b of [mix, oven]) {
    b.checked = false;
    b.dispatchEvent({ type: "change" });
  }
  assert.deepEqual(state.settings.scenario.skills, {},
    "unticking everything left an empty list behind rather than the answer it means");
});

test("a job that cannot fit somebody's hours is said, never quietly moved (v177)", () => {
  // Somebody here for the first five minutes of a day whose work starts later. The
  // job still goes to them — a rule that refused it would be a rule that hides work,
  // which is the one thing this app does not do — and the card says what is wrong.
  const { root } = render({ shifts: { 1: { startMin: 0, endMin: 5 } } });
  openPerson(root, "Person 1");
  assert.match(popupBody(), /cannot fit inside those hours/,
    "a job running past somebody's own hours is not said anywhere on their card");
  assert.match(popupBody(), /Here 4:00 am → 4:05 am/,
    "the card does not read back the hours the day is using");

  // And the hours are on the card of a day with none, reading as what absence means.
  const plain = render();
  openPerson(plain.root, "Person 1");
  assert.match(popupBody(), /Here all day/,
    "a person with no hours set does not say that they are here all day");
  assert.doesNotMatch(popupBody(), /cannot fit inside those hours/,
    "a day with no hours set claims a job cannot fit somewhere");
});

test("opening a day never inherits the hours of the day she was on before (v177)", () => {
  // The round-trip trap. `openScenario` assigns a copy onto the day already in
  // memory, so a key the copy leaves out is not dropped — the day she opens silently
  // keeps the hours of the day she left, with nothing on the screen saying so.
  const saved = {
    ...ONE_BAKER_SCENARIO, id: "s_plain", name: "A plain day",
    modules: ONE_BAKER_SCENARIO.modules.map((m) => ({ ...m })),
    shifts: {}, skills: {},
  };
  const { root, state } = render({ shifts: { 1: { startMin: 60, endMin: 300 } } });
  state.settings.scenarios = [saved];
  renderScenario(root, state);
  const row = walk(root).find((n) => hasClass(n, "sc-row") && textOf(n).includes("A plain day"));
  assert.ok(row, "the saved day is not on her shelf");
  row.dispatchEvent({ type: "click" });

  assert.deepEqual(state.settings.scenario.shifts, {},
    "the hours of the day she left are still on the day she opened");
  assert.equal(walk(root).filter((n) => hasClass(n, "tl-shift")).length, 0,
    "the opened day is drawn wearing hours it does not have");
});

test("a board tells a worker when they are here, and a tap on it writes nothing (v177)", () => {
  const scen = { ...ONE_BAKER_SCENARIO, modules: ONE_BAKER_SCENARIO.modules.map((m) => ({ ...m })), shifts: { 1: { startMin: 60, endMin: 300 } } };
  const state = {
    settings: { currency: "RM", deliveryDays: [1, 3, 5], scenario: scen, scenarios: [] },
    uoms: [], ingredients: [], products: [], orders: [], deliveryDates: [],
  };
  const root = createEl("div");
  renderBoard(root, state);

  const row = walk(root).find((n) => hasClass(n, "tl-row") && hasClass(n, "train") && textOf(n).includes("Person 1"));
  assert.ok(row, "the board has no person rows");
  const before = JSON.stringify(state.settings);
  row.dispatchEvent({ type: "click" });
  // "When am I here" is the first question of a working day, so a board that prints
  // their jobs without it would be answering the second question first.
  assert.match(popupBody(), /Here 5:00 am → 9:00 am/,
    "the board does not tell a worker when they are here");
  assert.equal(JSON.stringify(state.settings), before,
    "a tap on the board wrote to her settings");

  // What v184 changed, and only this: the BAND leaves the TRAIN's rows. The band is
  // drawn at `round(startMin * pxPerMin)` — arithmetic on the day's minute axis — and a
  // train is a strip of work with no minute axis to draw it on, so the same band across
  // an arbitrary coach would be a quiet lie. The HOURS are not lost: they are said in the
  // row's own tip, and on the card this tap just opened. Nothing about her stored hours
  // moves.
  //
  // It is the train's rows only. Since v185 a board draws the planner's own people's
  // window underneath the train — her "we keep it original" — and that window is on the
  // day's minute axis, so it goes on wearing the band it always wore, on the board as
  // much as on the planner. Asserting zero bands across the whole board would have been
  // asserting that the planner's window had been altered after all.
  const trainRows = walk(root).filter((n) => hasClass(n, "tl-row") && hasClass(n, "train"));
  assert.ok(trainRows.length, "the board drew no train rows to test");
  assert.equal(trainRows.filter((n) => walk(n).some((x) => hasClass(x, "tl-shift"))).length, 0,
    "the board's train rows still wear a band drawn off a minute axis they no longer have");
  assert.ok(walk(root).filter((n) => hasClass(n, "tl-row") && !hasClass(n, "train") && walk(n).some((x) => hasClass(x, "tl-shift"))).length,
    "the planner's window on the board lost the band it draws on the planner, so it was altered rather than kept");
  assert.match(textOf(tipOf(row)), /Here 5:00 am → 9:00 am/,
    "the board's row tip no longer says when the worker is here");
  assert.deepEqual(scen.shifts, { 1: { startMin: 60, endMin: 300 } },
    "opening the board rewrote the hours she typed");

  // And it is the same card MINUS the switches: who is on what, and who is trained
  // for what, are hers.
  assert.equal(hourBoxes().length, 0, "the board's person card offers the planner's hour boxes");
  assert.equal(walk(layers["popup-layer"]).filter((n) => hasClass(n, "row-check")).length, 0,
    "the board's person card offers the planner's training ticks");
});
