// test/snapshot-view.test.js — the Restore/Import screen's read-only look (v584).
//
// ⚠️⚠️ THIS SCREEN HAD NO TEST AT ALL. ⚠️ It is the one place her whole book can be read back from a cloud
// copy, so its three answers — shown, not loadable, not readable — are worth pinning: **a copy that cannot be
// opened must say so, and one that opens must never claim to have changed anything.**

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, value: "", checked: false, disabled: false, hidden: false,
    _listeners: {}, _cls: new Set(),
    classList: {
      add(...cs) { for (const c of cs) node._cls.add(String(c)); },
      remove(...cs) { for (const c of cs) node._cls.delete(String(c)); },
      toggle(c, on) { if (on === undefined ? !node._cls.has(c) : on) node._cls.add(c); else node._cls.delete(c); },
      contains(c) { return node._cls.has(String(c)); },
    },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) this.children.push(c == null ? { nodeType: 3, text: "null" } : c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) this.children.push(c == null ? { nodeType: 3, text: "null" } : c); },
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

const registry = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: createEl("body"),
};
globalThis.window = { addEventListener() {}, removeEventListener() {}, open() {} };
globalThis.localStorage = { _m: new Map(), getItem(k) { return this._m.get(k) ?? null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };

const { openSnapshotView } = await import("../admin/js/views/snapshot.js");

const all = (n, out = []) => { for (const c of n.children || []) { out.push(c); if (c.nodeType === 1) all(c, out); } return out; };
const text = (n) => String(n.textContent || "");
const lastToast = () => {
  const toasts = document.body.children.filter((c) => c.className === "toast");
  return toasts.length ? text(toasts[toasts.length - 1]) : "";
};
const settle = () => new Promise((r) => setTimeout(r, 0));

const row = { id: "b1", label: "Daily · 18 Oct", kind: "daily", engine: "583",
  created_at: "2026-10-18T01:00:00.000Z" };

test("★★★ a copy that opens shows what was in it, and says it changed nothing (v584)", async () => {
  registry["popup-layer"] = createEl("div");
  const state = { orders: [], products: [], ingredients: [], deliveryDates: [], settings: { currency: "RM" } };
  openSnapshotView(state, row, async () => ({ ok: true, row: {
    ...row, data: JSON.stringify({ orders: [], products: [], ingredients: [], deliveryDates: [], settings: { currency: "RM" } }),
  } }));
  await settle();
  const popup = registry["popup-layer"];
  assert.match(text(popup), /Read-only look/, "★ the screen does not say it is a look and not a restore");
  assert.match(text(popup), /0 orders/, "★ the copy's own contents are not read out");
  assert.match(text(popup), /Daily · 18 Oct/, "★ the popup does not carry the copy's name");
});

test("★★★ a copy that cannot be loaded says WHY, and draws nothing (v584)", async () => {
  registry["popup-layer"] = createEl("div");
  openSnapshotView({}, row, async () => ({ ok: false, reason: "no signal" }));
  await settle();
  assert.match(lastToast(), /no signal/, "★ a copy that would not load left her with no word at all");
  assert.equal(registry["popup-layer"].children.length, 0,
    "★ a popup was drawn over a copy that could not be read");
});

test("★★★ a copy whose text is unreadable says so rather than opening empty (v584)", async () => {
  registry["popup-layer"] = createEl("div");
  openSnapshotView({}, row, async () => ({ ok: true, row: { ...row, data: "{not json" } }));
  await settle();
  assert.match(lastToast(), /couldn't be read/,
    "★ unreadable text opened as an empty copy — the one answer that would read as a lost book");
  assert.equal(registry["popup-layer"].children.length, 0, "and a popup was drawn anyway");
});
