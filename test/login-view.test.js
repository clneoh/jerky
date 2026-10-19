// test/login-view.test.js — the shared-data sign-in gate's answers (v584).
//
// ⚠️⚠️ THE ERROR BRANCH HAD NO TEST AT ALL. ⚠️ If a refused sign-in left the button dead, or said nothing,
// she would be looking at a gate with no way to know what went wrong — and this is the screen whose whole job
// is to be the only way in.

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
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === "disabled") node.disabled = true; },
    getAttribute(k) { return this.attrs[k]; },
    querySelector: () => null,
    querySelectorAll: () => [],
    focus() {}, click() {},
  };
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  return node;
}

globalThis.document = {
  createElement: createEl, createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: createEl("body"),
};
globalThis.localStorage = { _m: new Map(), getItem(k) { return this._m.get(k) ?? null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };

const { renderLogin } = await import("../admin/js/views/login.js");

const all = (n, out = []) => { for (const c of n.children || []) { out.push(c); if (c.nodeType === 1) all(c, out); } return out; };
const text = (n) => String(n.textContent || "");
const settle = () => new Promise((r) => setTimeout(r, 0));

function screen(extra = {}) {
  const root = createEl("div");
  const inputs = () => all(root).filter((n) => n.tagName === "INPUT");
  const btn = () => all(root).find((n) => n.tagName === "BUTTON" && text(n) === "Sign in");
  const error = () => all(root).find((n) => String(n.className).includes("card-sub") && /Fill in|fail|credential/i.test(text(n)));
  renderLogin(root, { settings: { supabase: {} } }, extra);
  return { root, inputs, btn, error };
}

test("★★★ a blank form says what to fill in, and does not try to sign in (v584)", () => {
  let asked = 0;
  const s = screen({ signIn: async () => { asked += 1; } });
  s.btn()._listeners.click.forEach((f) => f());
  assert.match(text(s.error()), /Fill in the URL, anon key, email and password/,
    "★ the gate refused in silence — she cannot tell what is missing");
  assert.equal(asked, 0, "★ a blank form was sent to the server");
});

test("★★★ a refused sign-in says WHY, and gives the button back (v584)", async () => {
  const s = screen({ signIn: async () => { throw new Error("Invalid login credentials"); } });
  const [url, key, email, pw] = s.inputs();
  url.value = "https://x.supabase.co"; key.value = "anon"; email.value = "a@b.c"; pw.value = "pw";
  s.btn()._listeners.click.forEach((f) => f());
  await settle();
  assert.match(text(s.error()), /Invalid login credentials/,
    "★ a refused sign-in left her with no reason for it");
  assert.equal(s.btn().disabled, false, "★ the button stayed dead after a refusal");
  assert.equal(text(s.btn()), "Sign in", "★ the button still says it is signing in");
});

test("★★ and a sign-in that lands goes straight on (v584)", async () => {
  let ok = 0;
  const s = screen({ signIn: async () => {}, onSuccess: () => { ok += 1; } });
  const [url, key, email, pw] = s.inputs();
  url.value = "https://x.supabase.co"; key.value = "anon"; email.value = "a@b.c"; pw.value = "pw";
  s.btn()._listeners.click.forEach((f) => f());
  await settle();
  assert.equal(ok, 1, "a successful sign-in did not carry on into the app");
});
