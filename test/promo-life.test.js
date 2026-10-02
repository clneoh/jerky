// test/promo-life.test.js — a code's LIFE (v278): printed, paused, ended.
//
// Slice 4 of the promo-code build. Two rules are held here, and each is a claim
// that would go silent if it broke:
//
//   1. PRINTING PINS THE PROMISE. Once a card is in someone's hand the offer on
//      it has to go on being true, so a frozen code refuses any change to what it
//      gives, who it is for, the smallest basket, what it cannot sit beside, or
//      its name — and refuses having its end date pulled earlier or its ceiling
//      lowered. Two directions stay open on purpose, because being generous with
//      someone holding a card cannot hurt them and taking something back can:
//      the end date may be moved LATER (or dropped) and the ceiling RAISED.
//
//   2. THE TWO BRAKES ARE ON THE ROW, and they are what a printed code still
//      allows. A pause is a break and reverses; ending is final and refuses new
//      uses while KEEPING what it already promised — ending never rewrites
//      history. A paused or ended code used to look exactly like a live one in
//      the list; the chips say what the row cannot.
//
// The engine half is pure. The view half drives the REAL renderPromoCodes
// against a stand-in page — the screens it lives on sit behind the sign-in, so
// this is the closest anyone gets to tapping it here.
//
// Every test in this file was bitten by reverting the behaviour in place. A test
// that cannot fail is not a test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { blankCode, freezeProblem, frozenProblem, normalizeCode, stoppedBy } from "../admin/js/promo.js";
import { usageOf } from "../admin/js/promo-usage.js";

/* ─────────────────────────── the engine: what printing pins ─────────────── */

// A printed code, as the app would store one: every family present, only the ones
// a test cares about overridden. Same helper shape as test/promo.test.js.
function printed(over = {}) {
  return {
    ...blankCode(),
    id: "promo_1",
    code: "PRINTED",
    frozen: true,
    vis: "public",
    gives: { type: "pct", value: 10, cap: 15 },
    when: { from: "2026-10-01", to: "2026-12-31" },
    often: { type: "quota", n: 50, maxRM: 200 },
    ...over,
  };
}

// The same code with one thing changed, as the Edit card hands it to the engine.
const as = (before, after) => frozenProblem(before, { ...before, ...after });

test("a printed code refuses a change to what it gives", () => {
  const b = printed();
  assert.deepEqual(as(b, { gives: { type: "pct", value: 30, cap: 15 } }), { fail: "frozenGives" });
  // The type is part of the promise, not only the number: RM10 off and 10% off
  // are different offers on the same card.
  assert.deepEqual(as(b, { gives: { type: "rm", value: 10, cap: 0 } }), { fail: "frozenGives" });
  // So is the cap on a percentage — the most it can ever take off.
  assert.deepEqual(as(b, { gives: { type: "pct", value: 10, cap: 25 } }), { fail: "frozenGives" });
});

test("a printed code refuses a change to who it is for", () => {
  assert.deepEqual(as(printed(), { who: { type: "first" } }), { fail: "frozenWho" });
});

test("a printed code refuses a change to the smallest basket", () => {
  const b = printed();
  assert.deepEqual(as(b, { basket: { type: "amount", amount: 30 } }), { fail: "frozenBasket" });
  // Raising the minimum is the same refusal as introducing one: the card says
  // what basket works, and a bigger one would strand the card.
  const withMin = printed({ basket: { type: "amount", amount: 30 } });
  assert.deepEqual(as(withMin, { basket: { type: "amount", amount: 50 } }), { fail: "frozenBasket" });
});

test("a printed code refuses a change to what it cannot sit beside", () => {
  assert.deepEqual(as(printed(), { beside: { type: "nocredit" } }), { fail: "frozenBeside" });
});

test("a printed code refuses a new name", () => {
  assert.deepEqual(as(printed(), { code: "OTHERX" }), { fail: "frozenName" });
});

test("a printed code refuses an end date that is pulled earlier, or invented", () => {
  const b = printed();
  // 2026-11-30 is still AFTER the start date, so this is not the ordinary
  // dates-backwards check — it is the freeze, and it is the freeze's own reason.
  assert.deepEqual(as(b, { when: { from: "2026-10-01", to: "2026-11-30" } }), { fail: "frozenDates" });
  // A code that never ran out cannot be given an end date by a card that never
  // printed one: that is a promise taken back from everyone holding it.
  const open = printed({ when: { from: "2026-10-01", to: "" } });
  assert.deepEqual(as(open, { when: { from: "2026-10-01", to: "2027-12-31" } }), { fail: "frozenDates" });
  // Nor may its start be pushed later — the same promise, taken back.
  assert.deepEqual(as(b, { when: { from: "2026-11-01", to: "2026-12-31" } }), { fail: "frozenDates" });
});

test("a printed code ACCEPTS a later end date, and accepts losing one", () => {
  const b = printed();
  assert.equal(as(b, { when: { from: "2026-10-01", to: "2027-03-31" } }), null);
  assert.equal(as(b, { when: { from: "2026-10-01", to: "" } }), null);
  // Bringing the START forward is generosity too.
  assert.equal(as(b, { when: { from: "2026-09-01", to: "2026-12-31" } }), null);
});

test("a printed code refuses a ceiling that is lowered, and ACCEPTS one that is raised", () => {
  const b = printed();
  assert.deepEqual(as(b, { often: { type: "quota", n: 20, maxRM: 200 } }), { fail: "frozenCeiling" });
  assert.deepEqual(as(b, { often: { type: "quota", n: 50, maxRM: 100 } }), { fail: "frozenCeiling" });
  // 0 is "no limit at all" — the top of the scale — so 200 -> 0 is a RAISE.
  assert.equal(as(b, { often: { type: "unlimited", n: 0, maxRM: 0 } }), null);
  assert.equal(as(b, { often: { type: "quota", n: 100, maxRM: 200 } }), null);
  assert.equal(as(b, { often: { type: "quota", n: 50, maxRM: 500 } }), null);
  // An unlimited code has no ceiling to lower, so adding one is the refusal.
  const open = printed({ often: { type: "unlimited", n: 0, maxRM: 0 } });
  assert.deepEqual(as(open, { often: { type: "quota", n: 10, maxRM: 0 } }), { fail: "frozenCeiling" });
});

test("printing does NOT freeze the parts a card never printed", () => {
  const b = printed();
  // Her own sentence for the shop, who may see it, and the two brakes — a rule
  // that froze these would leave her with a code she could neither stop nor
  // restart, and a shop line she could never fix.
  assert.equal(as(b, { say: "A new sentence for the shop." }), null);
  assert.equal(as(b, { vis: "personal" }), null);
  assert.equal(as(b, { state: "paused" }), null);
  assert.equal(as(b, { state: "ended" }), null);
});

test("an UNPRINTED code is never refused — the freeze is only about what printing pins", () => {
  const loose = normalizeCode({ ...printed(), frozen: false });
  const rewritten = {
    code: "DIFFERENT", state: "ended", vis: "personal",
    gives: { type: "rm", value: 99, cap: 0 },
    who: { type: "first" },
    when: { from: "2026-01-01", to: "2026-02-01" },
    basket: { type: "amount", amount: 500 },
    beside: { type: "nocredit" },
    often: { type: "quota", n: 1, maxRM: 1 },
  };
  assert.equal(frozenProblem(loose, { ...loose, ...rewritten }), null);
});

/* ────────────────────── the engine: what may be frozen at all ───────────── */

test("a code with no ceiling cannot be printed — the ceiling is the whole gate", () => {
  // A card carries no number and no end date, so the ceiling is the ONLY thing
  // left bounding what it can cost. An unbounded offer on a piece of paper nobody
  // can count is exactly the shape a launch that works would find, so this is a
  // refusal rather than a warning.
  const bare = { ...printed(), frozen: false, often: { type: "unlimited", n: 0, maxRM: 0 } };
  assert.deepEqual(freezeProblem(bare), { fail: "noCeiling" });
  // An uncapped PERCENTAGE is the sharpest case of the same thing, and it is the
  // one the plan named: nothing limits what 10% repeated is worth.
  assert.deepEqual(freezeProblem({ ...bare, gives: { type: "pct", value: 10, cap: 0 } }), { fail: "noCeiling" });
  // EITHER bound is enough. A quota counts; a ringgit total counts; a percentage
  // capped in ringgit counts even with no order limit at all.
  assert.equal(freezeProblem({ ...bare, often: { type: "quota", n: 1, maxRM: 0 } }), null);
  assert.equal(freezeProblem({ ...bare, often: { type: "unlimited", n: 0, maxRM: 50 } }), null);
  assert.equal(freezeProblem({ ...bare, often: { type: "unlimited", n: 0, maxRM: 50 }, gives: { type: "pct", value: 10, cap: 0 } }), null);
  // 0 is "no limit", not a small limit — a quota box reading 0 is a limit she has
  // not finished setting, and it must not pass the gate as though it were one.
  assert.deepEqual(freezeProblem({ ...bare, often: { type: "quota", n: 0, maxRM: 0 } }), { fail: "noCeiling" });
});

test("a code with no name cannot be printed — the card would carry nothing to type", () => {
  assert.deepEqual(freezeProblem({ ...printed(), frozen: false, code: "" }), { fail: "freezeNoCode" });
  // The name is asked about BEFORE the ceiling, because a card with no code on it
  // is useless however well bounded the offer behind it is.
  assert.deepEqual(freezeProblem({ ...printed(), frozen: false, code: "", often: { type: "unlimited", n: 0, maxRM: 0 } }),
    { fail: "freezeNoCode" });
});

test("an already-printed code passes the gate — printing is not a thing you can do twice", () => {
  // Pressing Print on a code that is already printed is harmless and changes
  // nothing; the gate is about whether the FIRST card could be honest, not about
  // counting presses.
  assert.equal(freezeProblem(printed()), null);
});

/* ─────────────────────────── the engine: ending keeps its history ───────── */

test("an ended code still counts every order it already had", () => {
  const ended = { ...printed(), code: "GONENOW", frozen: false, state: "ended" };
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
  const paused = { ...printed(), code: "PAUSED5", frozen: false, state: "paused" };
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
    CODE({ id: "p4", code: "PRINTED", frozen: true, gives: { type: "pct", value: 10, cap: 15 }, often: { type: "quota", n: 50, maxRM: 200 } }),
  ]);
  paint(state);
  assert.deepEqual(chipsOf("ALIVE10"), [], "a live code wears no chip — the row says nothing rather than 'Live'");
  assert.deepEqual(chipsOf("PAUSED5"), ["Paused"]);
  assert.deepEqual(chipsOf("GONENOW"), ["Ended"]);
  assert.deepEqual(chipsOf("PRINTED"), ["Printed — fixed"]);
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
  const printedState = stateWith([CODE({ code: "PRINTED", frozen: true, gives: { type: "pct", value: 10, cap: 15 }, often: { type: "quota", n: 50, maxRM: 200 } })]);
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

test("a printed code's Edit press says what may still move", () => {
  const state = stateWith([CODE({ code: "PRINTED", frozen: true, gives: { type: "pct", value: 10, cap: 15 }, often: { type: "quota", n: 50, maxRM: 200 } })]);
  paint(state);
  pressOf(cardOf("PRINTED"), "Edit").click();
  const cards = ids.get("popup-layer").querySelectorAll(".popup-card");
  const words = cards.flatMap((c) => c.querySelectorAll("button")).map((b) => b.textContent);
  // The label must not promise a change the engine will refuse.
  assert.ok(words.includes("Update the end date and ceiling"), words.join(" | "));
  assert.ok(!words.includes("Update code"), "an unfrozen label would promise a rewrite the card forbids");
});

test("a printed code cannot be deleted — the tap names the press that does the job", () => {
  const state = stateWith([CODE({ code: "PRINTED", frozen: true, gives: { type: "pct", value: 10, cap: 15 }, often: { type: "quota", n: 50, maxRM: 200 } })]);
  paint(state);
  pressOf(cardOf("PRINTED"), "Delete").click();
  assert.equal(state.promoCodes.length, 1, "the code is still there");
  assert.equal(confirmLayer().hidden, true, "no delete confirmation was opened");
  assert.match(toastText(), /cannot be deleted/);
  assert.match(toastText(), /End it instead/, "and it points at the press that does");
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
  assert.match(note, /Print it press/, "it names the press that does the job");
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

test("Print it writes the card, and freezes the offer as it opens it", () => {
  const opened = watchOpen();
  const state = stateWith([CODE(PRINTABLE)]);
  paint(state);
  assert.ok(rowPress("FRESH10").includes("Print it"), rowPress("FRESH10").join(" | "));
  pressOf(cardOf("FRESH10"), "Print it").click();
  const said = confirmText();
  assert.match(said, /Print "FRESH10" on a card\?/);
  assert.match(said, /point of no return/, "she is told what the press is before she makes it");
  assert.match(said, /the amount, who it is for, the smallest basket and the name/, "what is about to be fixed is named");
  // The card prints no number, so the confirmation is the only place she is
  // reminded what is actually bounding the paper she is about to hand out.
  assert.match(said, /stops itself at 50 orders or RM 200\.00 given away, whichever is reached first/, said);
  confirmLayer().querySelectorAll("button").find((b) => b.textContent === "Print it").click();
  assert.equal(state.promoCodes[0].frozen, true, "the code is frozen in her own state");
  assert.deepEqual(opened, ["promo-card.html?code=FRESH10"], "and the card for that code is opened");
  assert.deepEqual(chipsOf("FRESH10"), ["Printed — fixed"], "the repainted row says what it is now");
  assert.ok(!rowPress("FRESH10").includes("Print it"), "and stops offering a second card");
});

test("the freeze is SAVED before the card is opened — the paper is drawn from the save", () => {
  // The card page reads the code back out of her own stored state, so a card
  // opened before the save landed would draw the offer as it was BEFORE printing.
  // Nothing about that failure is visible: the card would look right and the app
  // would disagree with it, which is the one thing a card must never do.
  const state = stateWith([CODE(PRINTABLE)]);
  paint(state);
  let frozenAtOpen = null;
  globalThis.window.open = () => {
    const stored = JSON.parse(globalThis.localStorage.getItem("bakeadmin.v1"));
    frozenAtOpen = stored.promoCodes[0].frozen;
    return null;
  };
  pressOf(cardOf("FRESH10"), "Print it").click();
  confirmLayer().querySelectorAll("button").find((b) => b.textContent === "Print it").click();
  assert.equal(frozenAtOpen, true, "the saved code was already frozen when the card opened");
});

test("Print it is REFUSED for an offer with no ceiling, and nothing is frozen", () => {
  const opened = watchOpen();
  // The plan's own case: an uncapped percentage with no ringgit ceiling. A public
  // code with nothing bounding it costs nothing to print and could cost everything.
  const state = stateWith([CODE({ gives: { type: "pct", value: 10, cap: 0 }, often: { type: "unlimited", n: 0, maxRM: 0 } })]);
  paint(state);
  pressOf(cardOf("FRESH10"), "Print it").click();
  assert.equal(confirmLayer().hidden, true, "no point-of-no-return dialog was opened at all");
  assert.match(toastText(), /Set a cost ceiling first/, toastText());
  assert.match(toastText(), /step 4/, "it sends her to the step that sets it");
  assert.equal(state.promoCodes[0].frozen, false, "nothing was frozen");
  assert.deepEqual(opened, [], "and no card was opened");
});

test("the ceiling the gate wants can be either bound — the money alone will do", () => {
  const opened = watchOpen();
  const state = stateWith([CODE({ often: { type: "unlimited", n: 0, maxRM: 80 } })]);
  paint(state);
  pressOf(cardOf("FRESH10"), "Print it").click();
  assert.equal(confirmLayer().hidden, false, "a ringgit ceiling is a ceiling");
  assert.match(confirmText(), /stops itself at RM 80\.00 given away/, confirmText());
  confirmLayer().querySelectorAll("button").find((b) => b.textContent === "Print it").click();
  assert.equal(state.promoCodes[0].frozen, true);
  assert.deepEqual(opened, ["promo-card.html?code=FRESH10"]);
});

test("only a public, live, unprinted code is offered a card at all", () => {
  const state = stateWith([
    CODE({ code: "PERSONAL", vis: "personal", often: { type: "quota", n: 5, maxRM: 50 } }),
    CODE({ id: "p2", code: "GONENOW", state: "ended", often: { type: "quota", n: 5, maxRM: 50 } }),
    CODE({ id: "p3", code: "PRINTED", frozen: true, often: { type: "quota", n: 5, maxRM: 50 } }),
    CODE({ id: "p4", code: "READY10", often: { type: "quota", n: 5, maxRM: 50 } }),
  ]);
  paint(state);
  // Step 6 is "Print it, IF IT IS PUBLIC" — a card is an advertisement, so a code
  // that is never advertised has nothing to print. An ended code has no promise
  // left to make, and a printed one already made it.
  assert.ok(!rowPress("PERSONAL").includes("Print it"));
  assert.ok(!rowPress("GONENOW").includes("Print it"));
  assert.ok(!rowPress("PRINTED").includes("Print it"));
  assert.ok(rowPress("READY10").includes("Print it"), "the one code that may be printed is offered it");
  // A paused code is still printable: pausing is a brake, not a decision about
  // whether the offer was ever made.
  const paused = stateWith([CODE({ code: "ONHOLD5", state: "paused", often: { type: "quota", n: 5, maxRM: 50 } })]);
  paint(paused);
  assert.ok(rowPress("ONHOLD5").includes("Print it"));
});

test("cancelling the card changes nothing at all", () => {
  const opened = watchOpen();
  const state = stateWith([CODE(PRINTABLE)]);
  paint(state);
  pressOf(cardOf("FRESH10"), "Print it").click();
  confirmLayer().querySelectorAll("button").find((b) => b.textContent === "Cancel").click();
  assert.equal(state.promoCodes[0].frozen, false);
  assert.deepEqual(opened, []);
  assert.deepEqual(chipsOf("FRESH10"), []);
});
