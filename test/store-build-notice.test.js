// test/store-build-notice.test.js — does the SHOP know when it is out of date?
//
// ★★★ HER AFTERNOON, 12 Oct 2026. She reported the shop "behaving differently from the bakery's" —
// and it was not: **her phone was running a two-month-old build** and there was no way to tell. The
// app on that same phone has had an amber "Update now" strip since v255; **the shop had nothing.**
//
// ⚠️⚠️ WHY THE SHOP NEEDS IT MORE THAN THE APP DOES. It re-fetches its DATA every 30 seconds and
// **never its own code**, so a stale page shows FRESH numbers on STALE behaviour — every figure on
// the screen agreeing with her, which is the worst way round for a fault to be. And a shop is a page
// a customer can leave open across an update, where an order placed against old code is a real order
// placed wrongly.
//
// The decision is pure (`newerBuild`, exported for the same reason `clockWords`/`postsOn` are), so
// this file pins the DECISION directly and the WIRING against the sources — the split this suite uses
// where a full page render would prove less.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ⚠️ THE SHOP BOOTS ITSELF ON IMPORT (`render()` at the foot of store/app.js), so this file needs
// just enough of a document for that to run. It is deliberately PERMISSIVE — every id answers with a
// fresh stand-in — because what this file is testing is ONE COMPARISON and the notice's wiring, not
// the page. A shim that tried to be faithful here would be a second copy of the shop's own tests.
function stubNode(tag = "div") {
  const n = {
    tagName: String(tag).toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, hidden: false,
    disabled: false, id: "", parentNode: null, _listeners: {},
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { for (const c of cs) this.children.push(c); },
    replaceChildren(...cs) { this.children = cs.filter((c) => c != null); },
    insertBefore(c) { this.children.unshift(c); return c; },
    remove() {}, focus() {}, blur() {}, scrollIntoView() {}, select() {}, setSelectionRange() {},
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    querySelector: () => null, querySelectorAll: () => [], closest: () => null, contains: () => false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  };
  return n;
}
// ⚠️⚠️ UNREF EVERY TIMER THE PAGE STARTS. The shop boots itself on import and schedules its own
// offer-turn and its 30-second poll; an un-unref'd timer keeps `node --test` alive for ever and the
// run reports a TIMEOUT for a file whose assertions all passed. **This is the same rule the
// press-everything pass records.**
for (const fn of ["setInterval", "setTimeout"]) {
  const real = globalThis[fn];
  globalThis[fn] = (cb, ms, ...rest) => {
    const t = real(cb, ms, ...rest);
    if (t && typeof t.unref === "function") t.unref();
    return t;
  };
}
const registry = new Map();
globalThis.document = {
  createElement: (t) => stubNode(t),
  createTextNode: (t) => ({ nodeType: 3, text: String(t) }),
  createDocumentFragment: () => stubNode("fragment"),
  getElementById: (id) => { if (!registry.has(id)) registry.set(id, stubNode()); return registry.get(id); },
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  documentElement: stubNode("html"), body: stubNode("body"), title: "", activeElement: null,
  visibilityState: "hidden",
};
globalThis.window = { addEventListener() {}, location: { hash: "" } };
globalThis.location = { hash: "", href: "http://localhost/store/", reload() {} };
globalThis.fetch = async () => ({ ok: true, text: async () => "" });

const { newerBuild } = await import("../store/app.js");

const SRC = readFileSync(new URL("../store/app.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../store/index.html", import.meta.url), "utf8");
const LANG = readFileSync(new URL("../store-lang.js", import.meta.url), "utf8");

test("★ a newer build is FOUND — the site's number differs from this page's", () => {
  assert.equal(newerBuild('export const ENGINE_VERSION = "477";', "476"), true,
    "a page on v476 never noticed the site serving v477");
  assert.equal(newerBuild('export const ENGINE_VERSION = "500";', "476"), true,
    "any later build counts, not only the next one");
});

test("★★ and the page it is RUNNING is not called newer than itself", () => {
  // ⚠️ The ordinary case by far: the site serves exactly what this page is running. A notice here
  // would appear on every shop, always — the fault that makes a real one invisible.
  assert.equal(newerBuild('export const ENGINE_VERSION = "476";', "476"), false);
});

test("★★⚠️ WHEN IT CANNOT TELL IT SAYS NOTHING — never a guess", () => {
  // ⚠️⚠️ This is the safety of the whole feature. A page that cried "out of date" on a bad
  // connection, a captive-portal login page, or a half-fetched file would be worse than one that
  // never spoke — **and the customer has done nothing wrong.** Every one of these must be SILENT.
  const silent = [
    ["", "an empty answer"],
    ["   ", "whitespace"],
    ["<!doctype html><html>Sign in to WiFi</html>", "a captive portal, not a version file at all"],
    ["export const SOMETHING_ELSE = 999;", "a file with no engine number in it"],
    ['export const ENGINE_VERSION = "latest";', "a build number that is not a number"],
    [null, "nothing at all"],
    [undefined, "and the same, undefined"],
  ];
  for (const [text, what] of silent) {
    assert.equal(newerBuild(text, "476"), false, `${what} was read as a newer build`);
  }
});

test("★★ the page ASKS the site, and asks PAST the browser's own copy", () => {
  // ⚠️⚠️ `cache: "no-store"` IS THE WHOLE MECHANISM. Without it the browser answers from the copy it
  // is holding — the very copy that is out of date — and the page would compare the stale file with
  // itself and always agree. **The one thing that must not be cached is the answer to "is this
  // cached?"**
  assert.match(SRC, /fetch\(\s*"\.\.\/admin\/js\/version\.js"\s*,\s*\{[^}]*cache:\s*"no-store"/,
    "the build check does not ask for the version file with cache: no-store");
  // ⚠️ AND IT IS THE SAME FILE THE PAGE ALREADY IMPORTS, so the number compared is the number the
  // foot prints — one source, and the two can never be different builds.
  assert.match(SRC, /import \{ ENGINE_VERSION \} from "\.\.\/admin\/js\/version\.js";/,
    "the shop no longer imports its own build number from the file it checks against");
});

test("★ the check runs once on arrival and again whenever the page comes back", () => {
  // ⚠️ THE PAGE'S OWN 30-SECOND `poll` ALREADY MEANS "the customer is here and looking" — it skips a
  // backgrounded tab and fires on visibility, focus and coming back online. Riding it is what makes
  // the notice appear while she is actually watching.
  assert.match(SRC, /const poll = async \(\) => \{[\s\S]{0,400}?checkBuild\(\)/,
    "the build check is not part of the page's own poll");
  assert.match(SRC, /setInterval\(poll, 30000\);[\s\S]{0,200}?checkBuild\(\)/,
    "the build check does not run once on arrival");
  // ⚠️ AND NEVER AWAITED: a customer must not be held up by a question about which build they are on.
  assert.match(SRC, /checkBuild\(\)/);
  assert.equal(/await checkBuild\(\)/.test(SRC), false, "the page waits on the build check");
});

test("★★⚠️ the RELOAD press remembers first, then reloads — and stops offering on the second sight", () => {
  // ⚠️⚠️ A BROWSER STILL HOLDING THE OLD SCRIPT SERVES IT STRAIGHT BACK, so the first press can
  // return the customer to the same notice with the same button — **a button that did nothing, which
  // is the fault the app's own strip learned at v256.** The remembered flag is what turns the second
  // sight into the honest "close the page and open it again".
  assert.match(SRC, /rememberBuildTried\(\);\s*\n\s*paintBuildNotice\(\);[\s\S]{0,120}?location\.reload\(\)/,
    "the reload press does not remember before it reloads");
  assert.match(SRC, /sessionStorage\.setItem\(BUILD_TRIED_KEY/, "the memory is not kept across a reload");
  // The second state: the sentence changes and the press goes.
  assert.match(SRC, /if \(say\) say\.hidden = tried;/, "the first sentence is not replaced on the second sight");
  assert.match(SRC, /if \(btn\) btn\.hidden = tried;/, "the press is still offered on the second sight");
});

test("★ the notice is AUTHORED hidden, so nothing flashes before the check has answered", () => {
  assert.match(HTML, /id="build-notice"[^>]*hidden/, "the build notice is not hidden in the markup");
  assert.match(HTML, /id="build-say"[^>]*data-i18n="buildStale"/, "the first sentence is not authored with its key");
  assert.match(HTML, /id="build-stuck"[^>]*data-i18n="buildStuck"[^>]*hidden/, "the second sentence is not authored hidden");
  assert.match(HTML, /id="build-reload"[^>]*data-i18n="buildReload"/, "the press is not authored with its key");
});

test("★★ a CUSTOMER reads all three languages, and the English matches the page", () => {
  const secs = ["en", "zh", "ms"];
  const values = {};
  for (const l of secs) {
    const at = LANG.indexOf(`const ${l} = {`);
    assert.notEqual(at, -1, `${l} is not in the dictionary`);
    const body = LANG.slice(at, LANG.indexOf("\n};", at));
    values[l] = ["buildStale", "buildStuck", "buildReload"].map((k) => {
      const m = new RegExp(`^\\s*${k}: "([^"]*)",`, "m").exec(body);
      assert.ok(m, `${l}.${k} is missing — a customer would meet a hole`);
      return m[1];
    });
    assert.ok(values[l].every((v) => v.trim().length > 0), `${l} has an empty build string`);
  }
  // ⚠️ THE DICTIONARY'S ENGLISH MUST BE THE MARKUP'S ENGLISH — the rule test/store-i18n.test.js
  // enforces for every authored line, and the reason the two cannot drift.
  for (const [i, key] of ["buildStale", "buildStuck", "buildReload"].entries()) {
    const inHtml = new RegExp(`data-i18n="${key}"[^>]*>([^<]*)<`).exec(HTML);
    assert.ok(inHtml, `${key} is not authored in the page`);
    assert.equal(inHtml[1].trim(), values.en[i], `${key}: the page and the dictionary disagree`);
  }
  // ⚠️ AND THEY MUST NOT BE THE SAME SENTENCE THREE TIMES. A copy-paste that left the English in the
  // other two is the exact fault the shop's own i18n test exists for.
  for (const l of ["zh", "ms"]) {
    for (const [i, key] of ["buildStale", "buildStuck", "buildReload"].entries()) {
      assert.notEqual(values[l][i], values.en[i], `${l}.${key} was left in English`);
    }
  }
});
