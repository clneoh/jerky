// test/pages.test.js — named landing pages, one per promotion or activity.
//
// A page is a middle layer, and the whole feature is the order the layers resolve
// in: the shared page (settings.taster), then the page a label picked, then the
// label's own line. Get the order wrong and a promotion's words lose to a stale
// line, or a label can no longer differ from the page it sits on. Get the
// *blank* wrong and a page with no heading blanks the customer's page instead of
// falling back. Both are invisible until a customer reads the wrong thing, so
// they are pinned here.
//
// `pageDraft` carries the same trap `codeDraft` does — trOverride is an ARRAY —
// so the array-safe copy is pinned a second time for the page record.

import { test } from "node:test";
import assert from "node:assert/strict";

// The views import the DOM helpers at module scope, so a minimal shim has to be
// in place before the dynamic import (the same shape test/codes-draft.test.js
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

const { pageOf, pageStats, linesFor, publishCodes } = await import("../admin/js/codes.js");
const { pageDraft, codeDraft } = await import("../admin/js/views/codes.js");
const { findPage, normalize } = await import("../admin/js/state.js");
const { isOverridden, markManual } = await import("../admin/js/translate.js");

const TODAY = "2026-09-20";
const SHARED = {
  heading: "Straight from our kitchen", headingZh: "厨房直送",
  body: "Treats your furkid will love", bodyZh: "你的毛孩会喜欢",
  askPet: true, follow: true, offerType: "rm", offerValue: 5, offerMin: 30, validDays: 30,
};

function stateWith({ codes = [], pages = [] } = {}) {
  return { codes, pages, products: [], partners: [], settings: { taster: SHARED, currency: "RM" } };
}

// ── which page a label reads ─────────────────────────────────────────────

test("a label reads the page it picked; a blank or missing one reads the shared page", () => {
  const page = { id: "pg1", name: "Raya promo" };
  const state = stateWith({ pages: [page] });

  assert.equal(pageOf(state, { code: "K3X9", pageId: "pg1" }), page);
  // Blank is the shared page — the default, and what a new label gets.
  assert.equal(pageOf(state, { code: "K3X9" }), null);
  assert.equal(pageOf(state, { code: "K3X9", pageId: "" }), null);
  // A page deleted after the label was printed falls back rather than breaking.
  assert.equal(pageOf(state, { code: "K3X9", pageId: "pgone" }), null);
  assert.equal(findPage(state, "pg1"), page);
  assert.equal(findPage(state, "pgone"), null);
  assert.equal(findPage(state, ""), null);
});

test("pageStats counts the labels reading a page, and nothing for the shared one", () => {
  const state = stateWith({
    pages: [{ id: "pg1" }, { id: "pg2" }],
    codes: [
      { code: "AAAAA", pageId: "pg1" },
      { code: "BBBBB", pageId: "pg1" },
      { code: "CCCCC", pageId: "pg2" },
      { code: "DDDDD" },
      { code: "EEEEE", pageId: "pgone" }, // its page is gone: it reads the shared page
    ],
  });
  assert.equal(pageStats(state, "pg1").labels, 2);
  assert.equal(pageStats(state, "pg2").labels, 1);
  assert.equal(pageStats(state, "pgone").labels, 1, "a dangling id still belongs to the record");
  assert.equal(pageStats(state, "").labels, 0, "the shared page is not a page with labels");
});

// ── the three layers ─────────────────────────────────────────────────────

test("the page sits over the shared page, and each language falls back on its own", () => {
  const page = { id: "pg1", name: "Raya promo",
    heading: "Raya is here", headingMs: "Raya tiba" };          // no 中文 heading
  const state = stateWith({ pages: [page] });

  const lines = linesFor(state, { code: "K3X9", pageId: "pg1" }, SHARED);
  assert.equal(lines.heading, "Raya is here", "the page beats the shared page");
  assert.equal(lines.headingMs, "Raya tiba", "the page's Malay line");
  assert.equal(lines.headingZh, SHARED.headingZh, "the page has no 中文 heading, so the shared one stands");
  assert.equal(lines.body, SHARED.body, "the page says nothing about the paragraph");
  // Not a copy of the shared page: the object handed out is its own.
  assert.equal(SHARED.heading, "Straight from our kitchen");
});

test("the base stops at the page — a label's own line is not part of it", () => {
  // This is the boundary that keeps the editor honest. `linesFor` answers "what
  // does the page say", which is what an EMPTY box falls back to; a label's own
  // line is the thing the box is for, and publishCodes is where it wins. Fold the
  // label in here and the editor would grey a label's own words into its own box.
  const page = { id: "pg1", name: "Raya promo", heading: "Raya is here" };
  const state = stateWith({ pages: [page] });
  const code = { code: "K3X9", pageId: "pg1",
    heading: "New here?",                                         // the label's own heading
    body: "Come say hello at the counter" };                      // and its own paragraph

  const lines = linesFor(state, code, SHARED);
  assert.equal(lines.heading, "Raya is here", "the page's, not the label's own line");
  assert.equal(lines.body, SHARED.body, "nor the label's own paragraph");
  // …but publishing the same label does carry its own words. Same three layers,
  // resolved in the same order, one step later.
  const [row] = publishCodes(stateWith({ pages: [page], codes: [{ ...code, kind: "promo", active: true }] }), TODAY);
  assert.equal(row.heading, "New here?");
  assert.equal(row.body, "Come say hello at the counter");
});

test("a page line that was left blank falls through to the shared page, never to an empty box", () => {
  // The whole reason the layers are merged rather than swapped: an editor showing
  // the page as its base would grey out nothing here, and a customer would read a
  // blank page. The line a customer actually gets is the shared one.
  const page = { id: "pg1", name: "Raya promo", heading: "Raya is here" }; // no body at all
  const state = stateWith({ pages: [page] });
  const lines = linesFor(state, { code: "K3X9", pageId: "pg1" }, SHARED);

  assert.equal(lines.heading, "Raya is here");
  assert.equal(lines.body, "Treats your furkid will love", "the shared paragraph, not a blank");
  assert.equal(lines.bodyMs, undefined, "the shared page has no Malay either, so nothing is invented");
});

test("a label with no page has the shared page as its base, exactly as before", () => {
  // Pages exist and other labels use them; this label picked none, so nothing
  // about it changed. The shared page's own switches ride along too — a page
  // carries words, never the ask-pet / follow switches.
  const state = stateWith({ pages: [{ id: "pg1", heading: "Raya is here" }] });
  const lines = linesFor(state, { code: "K3X9" }, SHARED);
  assert.equal(lines.heading, SHARED.heading);
  assert.equal(lines.body, SHARED.body);
  assert.equal(lines.askPet, true);
  assert.notEqual(lines.heading, "Raya is here", "another label's page does not leak in");
});

// ── what leaves the app ──────────────────────────────────────────────────

test("a published label carries its page's words, and its own win", () => {
  const page = { id: "pg1", name: "Raya promo",
    heading: "Raya is here", headingZh: "开斋节到了",
    body: "Sample packs all week" };
  const state = stateWith({
    pages: [page],
    codes: [
      { code: "K3X9", kind: "promo", active: true, pageId: "pg1",
        heading: "Only for you" },                                // the label's own line
      { code: "MILO", kind: "shop", active: true, pageId: "pg1" }, // the page, untouched
    ],
  });

  const [own, inherited] = publishCodes(state, TODAY);
  assert.equal(own.heading, "Only for you", "the label's own heading wins");
  assert.equal(own.headingZh, "开斋节到了", "the page still supplies the lines the label did not");
  assert.equal(own.body, "Sample packs all week");
  assert.equal(inherited.heading, "Raya is here");
  assert.equal(inherited.body, "Sample packs all week");
  // The page id itself is never published: the customer's page sees one flat shape
  // and cannot tell a label's line from its page's.
  assert.equal("pageId" in own, false);
  assert.equal("pageId" in inherited, false);
});

test("a blank line on the page is left out of the published row, so the shared page speaks", () => {
  const page = { id: "pg1", name: "Raya promo", heading: "Raya is here" }; // no body
  const state = stateWith({ pages: [page],
    codes: [{ code: "K3X9", kind: "promo", active: true, pageId: "pg1" }] });

  const [row] = publishCodes(state, TODAY);
  assert.equal(row.heading, "Raya is here");
  // Absent, not "": an empty string would be published as a real line that says
  // nothing and would blank the customer's page instead of falling back.
  assert.equal("body" in row, false);
});

test("deleting a page sends its labels back to the shared page, and keeps their own lines", () => {
  const before = stateWith({
    pages: [{ id: "pg1", name: "Raya promo", heading: "Raya is here", body: "All week" }],
    codes: [{ code: "K3X9", kind: "promo", active: true, pageId: "pg1", headingZh: "开斋节到了" }],
  });
  assert.equal(publishCodes(before, TODAY)[0].heading, "Raya is here");

  const after = { ...before, pages: [] }; // the page is gone
  const [row] = publishCodes(after, TODAY);
  assert.equal("heading" in row, false, "no page, so the shared page's heading shows");
  assert.equal("body" in row, false);
  assert.equal(row.headingZh, "开斋节到了", "the label's own line was never the page's to lose");
});

// ── the working copy a page is edited on ─────────────────────────────────

test("a page's hand-typed boxes come back as an array, not an object", () => {
  const page = { id: "pg1", name: "Raya promo", heading: "Raya is here",
    headingZh: "开斋节到了", trOverride: ["headingZh"], trSrc: { bodyMs: "Semua minggu" } };
  const draft = pageDraft(page);

  assert.ok(Array.isArray(draft.trOverride), "trOverride must stay an array");
  assert.deepEqual(draft.trOverride, ["headingZh"]);
  assert.equal(isOverridden(draft, "headingZh"), true, "so the box still reads as hers");
  assert.equal(isOverridden(draft, "bodyZh"), false);
});

test("nothing typed in the page pop-up reaches the record until Save", () => {
  const page = { id: "pg1", name: "Raya promo", heading: "Raya is here",
    trOverride: ["headingZh"], trSrc: { bodyMs: "Semua minggu" } };
  const draft = pageDraft(page);
  draft.name = "Something else";
  draft.heading = "Changed";
  markManual(draft, "bodyZh");

  assert.equal(page.name, "Raya promo");
  assert.equal(page.heading, "Raya is here");
  assert.deepEqual(page.trOverride, ["headingZh"]);
  assert.deepEqual(page.trSrc, { bodyMs: "Semua minggu" });
});

test("a page with no hand-typed boxes starts empty, and a wrong-shaped list is dropped", () => {
  const fresh = pageDraft(null);
  assert.ok(fresh.id, "a new page has an id");
  assert.equal(fresh.name, "");
  assert.equal("heading" in fresh, false, "no line is invented");
  // Nothing to be overridden yet, so the record carries no provenance at all
  // rather than an empty pair that would read as a claim.
  assert.equal("trOverride" in fresh, false);
  assert.equal("trSrc" in fresh, false);

  const odd = pageDraft({ id: "pg2", trOverride: { 0: "headingZh" } });
  assert.deepEqual(odd.trOverride, []);
});

// ── the two records ──────────────────────────────────────────────────────

test("a label cleaned up in the pop-up forgets a page that no longer exists", () => {
  const state = stateWith({ pages: [{ id: "pg1", name: "Raya promo" }] });
  const kept = codeDraft({ id: "c1", code: "K3X9", pageId: "pg1" }, state, SHARED, TODAY);
  assert.equal(kept.pageId, "pg1");

  const gone = codeDraft({ id: "c2", code: "MILO", pageId: "pgone" }, state, SHARED, TODAY);
  assert.equal(gone.pageId, "", "a dangling page becomes the shared page, which is what it already read");

  const fresh = codeDraft(null, state, SHARED, TODAY);
  assert.equal(fresh.pageId, "", "a new label starts on the shared page");
});

test("normalize keeps the pages list — it is the only thing that does", () => {
  // Without its own line in normalize() the list is silently dropped on every
  // load, and every label quietly falls back to the shared page.
  const s = stateWith({ pages: [{ id: "pg1", name: "Raya promo", heading: "Raya is here" }] });
  const out = normalize(JSON.parse(JSON.stringify(s)));
  assert.equal(out.pages.length, 1);
  assert.equal(out.pages[0].name, "Raya promo");
  assert.equal(out.pages[0].heading, "Raya is here");

  // A missing or wrong-shaped list becomes empty rather than leaking through.
  assert.deepEqual(normalize({ version: 1, settings: {} }).pages, []);
  assert.deepEqual(normalize({ version: 1, settings: {}, pages: "nope" }).pages, []);
});
