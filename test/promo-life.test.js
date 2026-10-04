// test/promo-life.test.js — a code's LIFE (v278): live, paused, ended.
//
// Slice 4 of the promo-code build, and the file lost a rule rather than gaining one
// (v287). Two claims are held here now:
//
//   1. A LABEL HAS A GATE. A code cannot be given a label without a name and a cost
//      ceiling, because a label carries no number and no end date — the ceiling is the
//      only thing left bounding what it can cost her.
//
//   2. THE TWO BRAKES ARE ON THE ROW. A pause is a break and reverses; ending is final
//      and refuses new uses while KEEPING what it already promised — ending never
//      rewrites history. A paused or ended code used to look exactly like a live one in
//      the list; the chips say what the row cannot.
//
// WHAT LEFT THIS FILE, and it is recorded rather than quietly lost. Eighteen tests used
// to hold "printing pins the promise": a printed code refused any change to what it
// gives, who it is for, the smallest basket, what it cannot sit beside and its name, and
// refused an end date pulled earlier or a ceiling lowered. The owner removed that rule on
// 4 Oct 2026 — a label is printed and copied as often as she likes, the offer stays
// editable, and a label is RETIRED by ending the code. The tests went with the rule,
// because a test for behaviour that no longer exists asserts nothing.
//
// The engine half is pure. The view half drives the REAL renderPromoCodes
// against a stand-in page — the screens it lives on sit behind the sign-in, so
// this is the closest anyone gets to tapping it here.
//
// Every test in this file was bitten by reverting the behaviour in place. A test
// that cannot fail is not a test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { blankCode, codeProblem, labelProblem, normalizeCode, stoppedBy } from "../admin/js/promo.js";
import { usageOf } from "../admin/js/promo-usage.js";
import { shopLink } from "../admin/js/promo-card.js";
import { todayISO } from "../admin/js/dates.js";
import { qrSvg } from "../admin/js/qr.js";

/* ─────────────────────────── the engine: the label's gate ───────────────── */

// A code as the app would store one: every family present, only the ones a test cares
// about overridden. Same helper shape as test/promo.test.js. It is no longer "printed"
// (v287): nothing about a code changes when a label is made from it.
function aCode(over = {}) {
  return {
    ...blankCode(),
    id: "promo_1",
    code: "PRINTED",
    vis: "public",
    gives: { type: "pct", value: 10, cap: 15 },
    when: { from: "2026-10-01", to: "2026-12-31" },
    often: { type: "quota", n: 50, maxRM: 200 },
    ...over,
  };
}


/* ──────────────────── the engine: whether a code may have a label ────────── */

test("a code with no ceiling cannot be printed — the ceiling is the whole gate", () => {
  // A card carries no number and no end date, so the ceiling is the ONLY thing
  // left bounding what it can cost. An unbounded offer on a piece of paper nobody
  // can count is exactly the shape a launch that works would find, so this is a
  // refusal rather than a warning.
  const bare = { ...aCode(), often: { type: "unlimited", n: 0, maxRM: 0 } };
  assert.deepEqual(labelProblem(bare), { fail: "noCeiling" });
  // An uncapped PERCENTAGE is the sharpest case of the same thing, and it is the
  // one the plan named: nothing limits what 10% repeated is worth.
  assert.deepEqual(labelProblem({ ...bare, gives: { type: "pct", value: 10, cap: 0 } }), { fail: "noCeiling" });
  // EITHER bound is enough. A quota counts; a ringgit total counts; a percentage
  // capped in ringgit counts even with no order limit at all.
  assert.equal(labelProblem({ ...bare, often: { type: "quota", n: 1, maxRM: 0 } }), null);
  assert.equal(labelProblem({ ...bare, often: { type: "unlimited", n: 0, maxRM: 50 } }), null);
  assert.equal(labelProblem({ ...bare, often: { type: "unlimited", n: 0, maxRM: 50 }, gives: { type: "pct", value: 10, cap: 0 } }), null);
  // 0 is "no limit", not a small limit — a quota box reading 0 is a limit she has
  // not finished setting, and it must not pass the gate as though it were one.
  assert.deepEqual(labelProblem({ ...bare, often: { type: "quota", n: 0, maxRM: 0 } }), { fail: "noCeiling" });
});

test("a code with no name cannot be printed — the card would carry nothing to type", () => {
  assert.deepEqual(labelProblem({ ...aCode(), code: "" }), { fail: "labelNoCode" });
  // The name is asked about BEFORE the ceiling, because a card with no code on it
  // is useless however well bounded the offer behind it is.
  assert.deepEqual(labelProblem({ ...aCode(), code: "", often: { type: "unlimited", n: 0, maxRM: 0 } }),
    { fail: "labelNoCode" });
});

/* ─────────────────────────── the engine: ending keeps its history ───────── */

test("an ended code still counts every order it already had", () => {
  const ended = { ...aCode(), code: "GONENOW", state: "ended" };
  const state = {
    products: [{ id: "p1", name: "Focaccia", price: 18, active: true }],
    orders: [
      { id: "o1", productId: "p1", qty: 1, status: "done", fulfillment: "collect", promo: "GONENOW", unitPrice: 18 },
      { id: "o2", productId: "p1", qty: 1, status: "done", fulfillment: "collect", promo: "GONENOW", unitPrice: 18 },
    ],
    promoCodes: [ended],
  };
  // Ending a code must not erase what it did: she still has to be able to say how
  // many orders carried it and what it gave away, or the end of a promotion would
  // also be the end of her record of it.
  const u = usageOf(state, ended);
  assert.equal(u.used, 2, "both orders still count");
  assert.ok(u.given > 0, "what it gave away is still known");
  // And it takes no NEW use: that is what ending means. The reason names the date
  // the code ended on, so a customer is never sent looking for a code that simply
  // stopped working one day.
  const stopped = stoppedBy(normalizeCode(ended), "2026-10-02");
  assert.equal(stopped.fail, "ended");
  assert.equal(stopped.on, "2026-12-31", "the date it ended is named, not implied");
});

test("a paused code still counts its orders, and refuses new use", () => {
  const paused = { ...aCode(), code: "PAUSED5", state: "paused" };
  const state = {
    products: [{ id: "p1", name: "Focaccia", price: 18, active: true }],
    orders: [{ id: "o1", productId: "p1", qty: 1, status: "new", fulfillment: "collect", promo: "PAUSED5", unitPrice: 18 }],
    promoCodes: [paused],
  };
  assert.equal(usageOf(state, paused).used, 1);
  assert.deepEqual(stoppedBy(normalizeCode(paused), "2026-10-02"), { fail: "paused" });
});

/* ─────────────────────────── the view, on a stand-in page ──────────────── */

// A page only as faithful as these tests need. Where a shim could be MORE
// forgiving than a browser it is not allowed to be: textContent replaces the
// children rather than sitting beside them, classList is backed by className,
// and a press actually runs the listener it was wired to.
const ids = new Map();

function matches(node, sel) {
  return String(sel || "").split(",").map((s) => s.trim()).filter(Boolean).some((s) => {
    const tag = (/^[A-Za-z][\w-]*/.exec(s) || [""])[0].toUpperCase();
    if (tag && node.tagName !== tag) return false;
    const cls = (s.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
    const own = String(node.className || "").split(/\s+/).filter(Boolean);
    return cls.every((c) => own.includes(c));
  });
}
function all(node, out = []) {
  for (const c of node.children || []) { out.push(c); all(c, out); }
  return out;
}

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", id: "", style: {}, value: "", checked: false, selected: false,
    disabled: false, hidden: false, scrollTop: 0, parent: null, _listeners: {},
    get parentNode() { return this.parent; },
    appendChild(c) { if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parent = this; } return c; },
    append(...cs) { for (const c of cs) if (c != null) { this.children.push(c); if (c.nodeType === 1) c.parent = this; } },
    replaceChildren(...cs) {
      this.children = [];
      for (const c of cs) {
        if (c && c.nodeType) { this.children.push(c); if (c.nodeType === 1) c.parent = this; }
        else this.children.push(globalThis.document.createTextNode(String(c)));
      }
    },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { this._listeners[t] = (this._listeners[t] || []).filter((x) => x !== f); },
    dispatchEvent(ev) {
      if (!ev.preventDefault) ev.preventDefault = () => { ev.defaultPrevented = true; };
      (this._listeners[ev.type] || []).forEach((f) => f(ev));
      return true;
    },
    click() { this.dispatchEvent({ type: "click", target: this }); },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === "hidden") this.hidden = true;
      if (k === "id") { this.id = String(v); ids.set(String(v), this); }
      if (k === "class") this.className = String(v);
      if (k === "disabled" || k === "selected" || k === "checked") this[k] = true;
      const m = /^data-(.+)$/.exec(k);
      if (m) this.dataset[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
    },
    getAttribute(k) { return this.attrs[k]; },
    querySelector(sel) { return all(this).find((n) => matches(n, sel)) || null; },
    querySelectorAll(sel) { return all(this).filter((n) => matches(n, sel)); },
    closest(sel) { for (let n = this; n; n = n.parent) if (n.nodeType === 1 && matches(n, sel)) return n; return null; },
    focus() {},
    remove() { if (!this.parent) return; const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); this.parent = null; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400 }),
    releasePointerCapture() {}, setPointerCapture() {},
  };
  Object.defineProperty(node, "textContent", {
    get() { let s = ""; for (const c of this.children) s += c.nodeType === 3 ? c.text : c.textContent; return s; },
    set(v) { this.children = v === "" ? [] : [globalThis.document.createTextNode(String(v))]; },
    configurable: true,
  });
  const list = () => String(node.className || "").split(/\s+/).filter(Boolean);
  node.classList = {
    add(...n) { node.className = [...new Set([...list(), ...n.filter(Boolean)])].join(" "); },
    remove(...n) { node.className = list().filter((c) => !n.includes(c)).join(" "); },
    contains: (c) => list().includes(c),
    toggle(c, force) { const on = force === undefined ? !list().includes(c) : Boolean(force); if (on) node.classList.add(c); else node.classList.remove(c); return on; },
  };
  return node;
}

const body = createEl("body");
for (const id of ["confirm-layer", "popup-layer"]) { const n = createEl("div"); n.setAttribute("id", id); n.hidden = true; body.appendChild(n); }

globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  createElementNS: (_ns, tag) => createEl(tag),
  body,
  getElementById: (id) => ids.get(id) || null,
  querySelector: (sel) => all(body).find((n) => matches(n, sel)) || null,
  querySelectorAll: (sel) => all(body).filter((n) => matches(n, sel)),
  scrollingElement: createEl("html"),
};
globalThis.window = { open() {}, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
// save() writes here. A stand-in, so a test can never touch her real profile.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
// Nothing leaves this process. maybeSyncStorefront bails anyway — no Supabase is
// configured in these states — so this is a belt on top of the braces.
globalThis.fetch = async () => { throw new Error("no network in tests"); };

const { renderPromoCodes } = await import("../admin/js/views/promo.js");

const root = createEl("main");

const CODE = (over) => ({ ...blankCode(), id: "p1", code: "FRESH10", vis: "public", gives: { type: "rm", value: 10, cap: 0 }, when: { from: "2026-10-01", to: "" }, ...over });

function stateWith(codes, orders = []) {
  return { promoCodes: codes, orders, products: [{ id: "p1", name: "Focaccia", price: 18, active: true }] };
}

const paint = (state) => renderPromoCodes(root, state);
// The card for one code, found by the name it prints.
const cardOf = (code) => root.querySelectorAll(".card").find((c) => {
  const t = c.querySelector(".card-title");
  return t && t.textContent.startsWith(code);
});
const chipsOf = (code) => (cardOf(code) ? cardOf(code).querySelectorAll(".st-chip").map((n) => n.textContent) : []);
const pressOf = (card, label) => card.querySelectorAll("button").find((b) => b.textContent === label);
const confirmLayer = () => ids.get("confirm-layer");
const popupLayer = () => ids.get("popup-layer");
const confirmText = () => (confirmLayer().querySelector(".confirm-text") || {}).textContent || "";
const toastText = () => (document.querySelector(".toast") || {}).textContent || "";

// Each test starts on a clean screen. Both dialogs are deliberately left open by
// some of the tests above — a card she is reading mid-decision — so without this
// a later test that asserts "no confirmation opened" would be reading the PREVIOUS
// test's dialog. A test that fails for the test before it is worse than no test.
test.beforeEach(() => {
  root.replaceChildren();
  for (const layer of [confirmLayer(), popupLayer()]) {
    layer.replaceChildren();
    layer.hidden = true;
  }
  const t = document.querySelector(".toast");
  if (t) { t.textContent = ""; t.classList.remove("show"); }
});

test("the row states a code's life: nothing when live, a chip when not", () => {
  const state = stateWith([
    CODE({ code: "ALIVE10" }),
    CODE({ id: "p2", code: "PAUSED5", state: "paused" }),
    CODE({ id: "p3", code: "GONENOW", state: "ended" }),
    // A code that has had a label printed from it wears NO chip (v287). Until then this
    // was "Printed — fixed", the amber chip that said the offer could no longer move.
    // Printing pins nothing now, so there is nothing left for the chip to say — and a
    // chip that said it anyway would be the app telling her a rule that is gone.
    CODE({ id: "p4", code: "LABELLED", gives: { type: "pct", value: 10, cap: 15 }, often: { type: "quota", n: 50, maxRM: 200 } }),
  ]);
  paint(state);
  assert.deepEqual(chipsOf("ALIVE10"), [], "a live code wears no chip — the row says nothing rather than 'Live'");
  assert.deepEqual(chipsOf("PAUSED5"), ["Paused"]);
  assert.deepEqual(chipsOf("GONENOW"), ["Ended"]);
  assert.deepEqual(chipsOf("LABELLED"), [], "and a code with a label on it is not marked as fixed");
});

test("the brakes match the life — and an ended code offers none", () => {
  const state = stateWith([
    CODE({ code: "ALIVE10" }),
    CODE({ id: "p2", code: "PAUSED5", state: "paused" }),
    CODE({ id: "p3", code: "GONENOW", state: "ended" }),
  ]);
  paint(state);
  const words = (code) => cardOf(code).querySelector(".row-actions").querySelectorAll("button").map((b) => b.textContent);
  assert.deepEqual(words("ALIVE10"), ["Pause", "End"]);
  assert.deepEqual(words("PAUSED5"), ["Resume", "End"]);
  // Ending is final, so an ended code has nothing left to press: a Resume here
  // would say the brake could be undone.
  assert.equal(cardOf("GONENOW").querySelector(".row-actions"), null);
  // A printed code keeps both brakes — they are the whole of what printing allows.
  const printedState = stateWith([CODE({ code: "PRINTED", gives: { type: "pct", value: 10, cap: 15 }, often: { type: "quota", n: 50, maxRM: 200 } })]);
  paint(printedState);
  assert.deepEqual(words("PRINTED"), ["Pause", "End"]);
});

test("the Pause press says what it will do, and how many orders it strands", () => {
  const state = stateWith(
    [CODE({ code: "ALIVE10" })],
    [
      { id: "o1", productId: "p1", qty: 1, status: "new", fulfillment: "collect", promo: "ALIVE10", unitPrice: 18 },
      { id: "o2", productId: "p1", qty: 1, status: "new", fulfillment: "collect", promo: "ALIVE10", unitPrice: 18 },
    ],
  );
  paint(state);
  pressOf(cardOf("ALIVE10"), "Pause").click();
  const said = confirmText();
  assert.match(said, /Pause "ALIVE10"\?/, "it names the code");
  // Two orders carry this code, so the sentence has to be plural AND agree with
  // itself — "2 orders carries it" is exactly the fault a single-branch plural
  // produces, and it is the sentence she reads before stopping a sale.
  assert.match(said, /2 orders carry it already and keep what they were promised/, said);
  assert.match(said, /You can switch it back on at any time/, "a pause is reversible and says so");
});

test("the Pause press is singular about one order, and honest about none", () => {
  const one = stateWith([CODE({ code: "ALIVE10" })],
    [{ id: "o1", productId: "p1", qty: 1, status: "new", fulfillment: "collect", promo: "ALIVE10", unitPrice: 18 }]);
  paint(one);
  pressOf(cardOf("ALIVE10"), "Pause").click();
  assert.match(confirmText(), /1 order carries it already and keeps what it was promised/);

  const none = stateWith([CODE({ code: "ALIVE10" })]);
  paint(none);
  pressOf(cardOf("ALIVE10"), "Pause").click();
  assert.match(confirmText(), /Nothing has used it yet, so nothing is stranded\./);
});

test("confirming the Pause turns the code off and the row says so", () => {
  const state = stateWith([CODE({ code: "ALIVE10" })]);
  paint(state);
  pressOf(cardOf("ALIVE10"), "Pause").click();
  const yes = confirmLayer().querySelectorAll("button").find((b) => b.textContent === "Pause it");
  yes.click();
  assert.equal(state.promoCodes[0].state, "paused", "the code is paused in her own state");
  assert.deepEqual(chipsOf("ALIVE10"), ["Paused"], "the repainted row says so");
  assert.deepEqual(cardOf("ALIVE10").querySelector(".row-actions").querySelectorAll("button").map((b) => b.textContent), ["Resume", "End"]);
});

test("ending says it is final, points at pause, and counts the money already given", () => {
  const state = stateWith([CODE({ code: "ALIVE10" })],
    [{ id: "o1", productId: "p1", qty: 1, status: "new", fulfillment: "collect", promo: "ALIVE10", unitPrice: 18 }]);
  paint(state);
  pressOf(cardOf("ALIVE10"), "End").click();
  const said = confirmText();
  assert.match(said, /End "ALIVE10" for good\?/);
  assert.match(said, /an ended code cannot be switched back on/, "it is not a second pause");
  assert.match(said, /If you only want a break, pause it instead/, "and it names the reversible press");
  assert.match(said, /RM 10\.00 in all/, "what it has already given away is stated");
});

test("an unprinted code still deletes — the refusal is only about print", () => {
  const state = stateWith([CODE({ code: "ALIVE10" })]);
  paint(state);
  pressOf(cardOf("ALIVE10"), "Delete").click();
  assert.equal(confirmLayer().hidden, false, "a normal delete confirms");
  confirmLayer().querySelectorAll("button").find((b) => b.textContent === "Delete").click();
  assert.equal(state.promoCodes.length, 0);
});

/* ─────────────────────────── the eleven steps ──────────────────────────── */

test("the eleven steps are all there, folded, with the sixth marked as the gate", () => {
  paint(stateWith([CODE({})]));
  const toggle = root.querySelector(".steps-toggle");
  assert.ok(toggle, "the fold line is on the screen");
  const list = root.querySelector(".steps");
  assert.ok(list.hidden, "the steps arrive folded — eleven rows of prose would be a wall");
  const steps = list.children;
  assert.equal(steps.length, 11, "eleven, in the order she would do them");
  // Step 6 is the only one that cannot be undone, so it is the only one shaded,
  // and it says what it is in words rather than by colour alone.
  assert.equal(steps[5].className, "gate");
  assert.equal(steps[5].querySelector(".gate-tag").textContent, "point of no return");
  assert.equal(steps.filter((s) => s.className === "gate").length, 1, "and it is the ONLY one");
  // A press opens it, and the arrow follows the fold.
  toggle.click();
  assert.equal(list.hidden, false);
  assert.equal(toggle.querySelector(".steps-arrow").textContent, "▾");
  toggle.click();
  assert.equal(list.hidden, true);
  assert.equal(toggle.querySelector(".steps-arrow").textContent, "▸");
});

test("the fold line answers where her codes actually are, not just a label", () => {
  const state = stateWith([
    CODE({ code: "ALIVE10" }),
    CODE({ id: "p2", code: "PAUSED5", state: "paused" }),
    CODE({ id: "p3", code: "GONENOW", state: "ended" }),
  ]);
  paint(state);
  const line = root.querySelector(".steps-line").textContent;
  assert.match(line, /1 live/, line);
  assert.match(line, /1 paused/, line);
  assert.match(line, /1 ended/, line);
  // The fold's own line is a whole row rather than sharing one: at 375px a shared
  // row cut a figure short, and a clipped figure is the one thing this line exists
  // not to be.
  assert.equal(root.querySelector(".steps-toggle").querySelectorAll(".steps-top").length, 1);
});

test("the steps no longer promise a card that is not there", () => {
  // The note under the list named step 6 as work still to come. It is now a press
  // on the row, and a note that says otherwise sends her looking for something the
  // screen already has.
  paint(stateWith([CODE({})]));
  const hints = root.querySelectorAll(".hint").map((h) => h.textContent);
  const note = hints.find((t) => t.includes("eleven"));
  assert.ok(note, "the note under the eleven steps is still there");
  assert.ok(!/next piece of work/.test(note), note);
  assert.match(note, /QR on a public code's row/, "it names the thing on the row that does the job (v287)");
  assert.match(note, /step 5/, "and the one step that is still not mechanised");
});

/* ───────────────────── the Print press, and the point of no return ──────── */

// A code that is allowed to be printed: public, live, unprinted, and with the
// ceiling the gate insists on.
const PRINTABLE = {
  code: "FRESH10",
  vis: "public",
  often: { type: "quota", n: 50, maxRM: 200 },
};

// window.open is a stub on the stand-in page, so a test can watch for it.
function watchOpen() {
  const opened = [];
  globalThis.window.open = (url) => { opened.push(url); return null; };
  return opened;
}

const rowPress = (code) => cardOf(code).querySelectorAll("button").map((b) => b.textContent);

test("the ceiling the gate wants can be either bound — the money alone will do", () => {
  const state = stateWith([CODE({ often: { type: "unlimited", n: 0, maxRM: 80 } })]);
  assert.equal(labelProblem(state.promoCodes[0]), null, "a ringgit ceiling is a ceiling");
});

test("Print it opens the label with NO dialog and changes nothing (v287)", () => {
  // It used to be the point of no return, behind a confirmation that named what was about
  // to stop being changeable. Nothing is fixed by printing now, so there is nothing to
  // confirm — and the whole of this test is that the press is a plain press again.
  const opened = watchOpen();
  // A ceiling is still required before a label may be made — a label carries no number,
  // so it is the only bound left. That gate is the one part of the old print flow that
  // is deliberately still here.
  const state = stateWith([CODE({ often: { type: "unlimited", n: 0, maxRM: 80 } })]);
  paint(state);
  const before = JSON.stringify(state.promoCodes[0]);
  pressOf(cardOf("FRESH10"), "Print it").click();
  assert.deepEqual(opened, ["promo-card.html?code=FRESH10"], "the card page opens");
  assert.equal(confirmLayer().hidden, true, "and nothing is asked first");
  assert.equal(JSON.stringify(state.promoCodes[0]), before, "pressing Print it changes no figure at all");
});

// ── v287: the label — the QR on the row, copy it or print it ──────────────────

const labelOf = (code) => cardOf(code).querySelectorAll(".label-qr")[0];
const fire = (node) => (node._listeners.click || []).forEach((f) => f());
// The file has no textOf, so the label's own words are read the same way the shim's
// other helpers read a node: its textContent, else its descendants'.
const nodeText = (n) => (n && (n.textContent || all(n).map(nodeText).join(""))) || "";
const copyable = (fn) => {
  const real = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let copied = null;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (t) => { copied = t; } } },
  });
  try { fn(); } finally {
    if (real) Object.defineProperty(globalThis, "navigator", real); else delete globalThis.navigator;
  }
  return copied;
};

test("every code's row carries a label, and it carries the word Label", () => {
  const state = stateWith([CODE()]);
  paint(state);
  const label = labelOf("FRESH10");
  assert.ok(label, "the row has a label on it — that is what makes a list of QRs");
  assert.ok(label.querySelectorAll(".label-qr-svg").length, "and it holds a drawn QR");
  assert.match(nodeText(label), /Label/, "and says what it is, rather than leaving a QR to be guessed at");
});

test("the label's QR encodes the shop's own link, the one the card also uses", () => {
  // A label and a printed card have to point at ONE url, or a scan lands somewhere the
  // code does not work. Both go through shopLink, and this holds the screen to it.
  const state = stateWith([CODE()]);
  paint(state);
  const svg = labelOf("FRESH10").querySelectorAll(".label-qr-svg")[0];
  assert.ok(svg.innerHTML, "the QR is drawn as an inline svg string");
  assert.ok(String(svg.innerHTML).startsWith("<svg"), "and it really is svg");
  const link = "https://munchies.com.my/store/?promo=FRESH10";
  assert.equal(shopLink("FRESH10", "https://munchies.com.my/admin/index.html"), link,
    "the link the label is built from");
  // AND THE SQUARE IS THE QR *OF* THAT LINK, not of something else. `qrSvg` is
  // deterministic, so drawing the expected square and holding it against the rendered one
  // is a real check — a label built from the wrong url, or from a hardcoded one, draws a
  // different pattern and this fails. (The browser harness decodes it as well, which is the
  // only way to prove it says what it says.)
  assert.equal(String(svg.innerHTML),
    qrSvg(link, { quiet: 2, dark: "#2b1d14", light: "#ffffff" }),
    "the drawn square is the QR of the shop's own link");
});

test("Copy on a label puts that same link on the clipboard", () => {
  const state = stateWith([CODE()]);
  paint(state);
  fire(labelOf("FRESH10"));
  const copied = copyable(() => pressOf(popupLayer(), "Copy link").click());
  assert.equal(copied, "https://munchies.com.my/store/?promo=FRESH10");
});

test("a retired code still shows its label, offers Copy, and says why it cannot print", () => {
  // Printing a label with an ended code in it would hand out something that does not work,
  // so the press is withheld — and SAID, rather than simply missing.
  const state = stateWith([CODE({ state: "ended" })]);
  paint(state);
  assert.ok(labelOf("FRESH10"), "the label is still there to look at");
  fire(labelOf("FRESH10"));
  assert.ok(pressOf(popupLayer(), "Copy link"), "copying a dead link is harmless and useful");
  assert.ok(!pressOf(popupLayer(), "Print it"), "but there is nothing worth printing");
  assert.match(nodeText(popupLayer()), /has ended, so there is nothing to print/);
});

// ── v286: a suggested code she can read off a card, and the customer can type ──

test("the New code card's Suggest one fills the box, and the code it gives actually saves", () => {
  const state = stateWith([CODE({ code: "FRESH10" })]);
  paint(state);
  const card = root.querySelectorAll(".card")
    .find((c) => (c.querySelector("h3") || {}).textContent === "New code");
  const box = card.querySelectorAll("input").find((i) => i.attrs.placeholder === "e.g. FRESH10");
  assert.ok(box, "the code box is on the card");
  assert.equal(box.value, "", "a new code starts with an empty box — nothing is chosen for her");

  pressOf(card, "Suggest one").click();
  assert.match(box.value, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/,
    "five characters, from the alphabet with no 0, O, 1, I or L in it");
  assert.notEqual(box.value, "FRESH10", "and never a name she already has");

  // A suggestion is only worth anything if it SAVES, so give it an amount and add it. This is
  // also what proves the suggested shape passes the engine's own name rule rather than only
  // looking right in the box.
  const amount = card.querySelectorAll("input").filter((i) => i.attrs.type === "number")[0];
  amount.value = "10";
  pressOf(card, "Add code").click();
  assert.equal(state.promoCodes.length, 2, "the suggested code went onto the list");
  assert.match(state.promoCodes[1].code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
  assert.ok(!/[0O1IL]/.test(state.promoCodes[1].code));
});

test("a code she types herself is untouched by any of this", () => {
  // The button is additive. Every code that already exists, and every code typed by hand,
  // keeps working exactly as it did — the shape rule was not narrowed to the safe alphabet.
  const state = stateWith([CODE({ code: "RAYA1O" })]);
  paint(state);
  const card = root.querySelectorAll(".card")
    .find((c) => (c.querySelector("h3") || {}).textContent === "New code");
  const box = card.querySelectorAll("input").find((i) => i.attrs.placeholder === "e.g. FRESH10");
  box.value = "MY1LOVE";
  const amount = card.querySelectorAll("input").filter((i) => i.attrs.type === "number")[0];
  amount.value = "5";
  pressOf(card, "Add code").click();
  assert.equal(state.promoCodes.length, 2, "a code with look-alikes in it is still accepted");
  assert.equal(state.promoCodes[1].code, "MY1LOVE", "stored exactly as she typed it");
});

test("nothing refuses a change to a code that has a label out (v287)", () => {
  // THE POSITIVE HALF OF THE REMOVAL, and the half that would otherwise go untested. Until
  // v287 a printed code refused all of this: a new name, a different amount, who it is for,
  // the smallest basket, what it sits beside, an end date pulled EARLIER and a ceiling
  // lowered. Every one of those is allowed now, and this test is what stops the rule being
  // quietly put back — an assertion that only checked "the freeze is gone" would pass again
  // the moment someone re-added a gate somewhere else.
  const out = aCode({ often: { type: "unlimited", n: 0, maxRM: 80 } });
  const rewritten = {
    ...out,
    code: "RENAMED1",
    gives: { type: "rm", value: 3, cap: 0 },
    who: { type: "first" },
    basket: { type: "amount", amount: 40 },
    beside: { type: "nocredit" },
    when: { from: "2026-10-01", to: "2026-10-02" },
    often: { type: "unlimited", n: 0, maxRM: 10 },
  };
  assert.equal(codeProblem([out], rewritten, out.id), null,
    "every family may be rewritten, the end date pulled earlier and the ceiling lowered");
});

// ── v288: how many times a label was opened ──────────────────────────────────
// A cloud fact on a synchronous screen: the slot is drawn empty and filled when the answer
// lands. Nothing shows until then, and nothing shows for good if the cloud cannot be reached.

const withCloud = (state) => {
  state.settings = { currency: "RM", supabase: {
    enabled: true, url: "https://x.supabase.co", anonKey: "anon", email: "a@b.c", password: "pw" } };
  return state;
};

const cloudAnswering = (rows) => async (url) => {
  if (url.includes("/auth/v1/token")) return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
  if (url.includes("promo_visit_days")) return { ok: true, json: async () => rows };
  return { ok: false, status: 404, json: async () => ({}) };
};

// The view does not await its own fill, so the test drains the microtasks it left behind.
const settled = () => new Promise((r) => setTimeout(r, 0));

test("each code's opens are filled in when the cloud answers (v288)", async () => {
  const state = withCloud(stateWith([CODE({ code: "FRESH10" }), CODE({ id: "p2", code: "RAYA5" })]));
  const realFetch = globalThis.fetch;
  globalThis.fetch = cloudAnswering([
    { code: "FRESH10", day: todayISO(), n: 4 },
    { code: "FRESH10", day: "2020-01-01", n: 1 },
  ]);
  try {
    paint(state);
    await settled();
    const fresh = cardOf("FRESH10");
    assert.match(nodeText(fresh), /Opened 5 times/, "the days are added up into one figure");
    const strip = fresh.querySelectorAll(".visit-strip")[0];
    assert.ok(strip, "and it comes with a bar per day");
    assert.equal(strip.querySelectorAll(".visit-bar").length, 28, "four weeks of them");
    assert.match(nodeText(cardOf("RAYA5")), /Not opened yet/,
      "a code the cloud DID answer about and which has no opens says so in words — that zero is real");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a read that fails leaves the row EXACTLY as it was — not a zero (v288)", async () => {
  // The whole reason the slot is drawn empty. "0 opens" is a positive claim about her label,
  // and this screen must not make it on the strength of a request that never came back.
  const state = withCloud(stateWith([CODE()]));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    paint(state);
    await settled();
    const card = cardOf("FRESH10");
    assert.equal(nodeText(card).includes("Opened"), false, "no count");
    assert.equal(nodeText(card).includes("Not opened yet"), false, "and no claim that nobody came");
    assert.equal(card.querySelectorAll(".visit-bar").length, 0, "and no strip");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("with no cloud configured the row is untouched too, and nothing is even asked", async () => {
  let called = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => [] }; };
  try {
    paint(stateWith([CODE()]));            // stateWith has no settings.supabase
    await settled();
    assert.equal(called, false, "the screen does not chatter at a shop that has no cloud");
    assert.equal(nodeText(cardOf("FRESH10")).includes("Opened"), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});
