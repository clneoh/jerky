// test/suggest.test.js — the right-arrow "accept the greyed suggestion" gesture
// (admin/js/suggest.js). A field opts in with data-suggest="<value>"; pressing →
// on an empty field, or tapping the arrow drawn at its right edge, puts the value
// in exactly as if typed (bubbling input + change fire).
//
// The same greyed slot elsewhere carries instructions and CREDENTIALS ("4 digits",
// "app login password", "anon public key (eyJ…)"). The last test pins the safety
// rule so a later edit cannot quietly make a fake key or password arrow-acceptable.

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptSuggestion, installSuggestionAccept } from "../admin/js/suggest.js";

// A tiny stand-in for a real <input>: enough for suggestionValue/fitsType and to
// record the events acceptSuggestion fires.
class FakeField {
  constructor({ type = "text", value = "", suggest, disabled = false, readOnly = false, rect, clientWidth } = {}) {
    this.tagName = "INPUT";
    this.type = type;
    this.value = value;
    this.disabled = disabled;
    this.readOnly = readOnly;
    this.dataset = suggest === undefined ? {} : { suggest };
    this.events = [];
    this._rect = rect || { width: 200, right: 300 };
    this.clientWidth = clientWidth;
    this.focused = false;
  }
  dispatchEvent(ev) { this.events.push(ev.type); return true; }
  addEventListener() {}
  removeEventListener() {}
  focus() { this.focused = true; }
  getBoundingClientRect() { return this._rect; }
}

// A stand-in for the document root: records listeners so a test can fire them.
function fakeRoot() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    fire(type, ev) { for (const fn of listeners[type] || []) fn(ev); },
  };
}

const keyEvent = (field, key, mods = {}) => ({
  key, target: field, ctrlKey: false, metaKey: false, altKey: false,
  preventDefault() { this.defaultPrevented = true; }, ...mods,
});

test("acceptSuggestion fills an empty field that offers a suggestion, as if typed", () => {
  const f = new FakeField({ suggest: "e.g. 2" });
  assert.equal(acceptSuggestion(f), true);
  assert.equal(f.value, "e.g. 2");
  assert.deepEqual(f.events, ["input", "change"], "the view's own handlers fire, in order");
});

test("a non-empty field is the baker's own — never overwritten", () => {
  const f = new FakeField({ value: "mine", suggest: "2" });
  assert.equal(acceptSuggestion(f), false);
  assert.equal(f.value, "mine");
  assert.deepEqual(f.events, []);
});

test("a field with no data-suggest offers nothing", () => {
  const f = new FakeField({});
  assert.equal(acceptSuggestion(f), false);
  assert.equal(f.value, "");
  assert.deepEqual(f.events, []);
});

test("a disabled or read-only field is left alone", () => {
  assert.equal(acceptSuggestion(new FakeField({ suggest: "2", disabled: true })), false);
  assert.equal(acceptSuggestion(new FakeField({ suggest: "2", readOnly: true })), false);
});

test("a number field refuses a suggestion it could not hold (never a silent blank)", () => {
  const bad = new FakeField({ type: "number", suggest: "two" });
  assert.equal(acceptSuggestion(bad), false);
  assert.equal(bad.value, "", "a non-numeric suggestion stays out rather than half-set");

  const good = new FakeField({ type: "number", suggest: "2" });
  assert.equal(acceptSuggestion(good), true);
  assert.equal(good.value, "2");
});

test("the keydown path acts on ArrowRight only, and takes the value it lands on", () => {
  const root = fakeRoot();
  installSuggestionAccept(root);
  const field = new FakeField({ suggest: "60123456789" });

  // A different key does nothing.
  const other = keyEvent(field, "ArrowLeft");
  root.fire("keydown", other);
  assert.equal(field.value, "", "only ArrowRight accepts");
  assert.ok(!other.defaultPrevented, "other keys are left to the browser");

  // ArrowRight on an empty field takes the value and blocks the caret move.
  const right = keyEvent(field, "ArrowRight");
  root.fire("keydown", right);
  assert.equal(field.value, "60123456789");
  assert.equal(right.defaultPrevented, true, "the caret cannot move into an empty field's suggestion");

  // A modified ArrowRight (text-selection shortcut) is left alone.
  const f2 = new FakeField({ suggest: "2" });
  const withMod = keyEvent(f2, "ArrowRight", { metaKey: true });
  root.fire("keydown", withMod);
  assert.equal(f2.value, "", "Cmd+→ is not the accept gesture");
  assert.ok(!withMod.defaultPrevented);
});

test("the pointerdown path accepts only in the right-edge arrow zone", () => {
  const root = fakeRoot();
  installSuggestionAccept(root);
  const field = new FakeField({ suggest: "2", rect: { width: 200, right: 300 } });

  // A tap on the greyed text (left side) only places the caret.
  root.fire("pointerdown", { target: field, clientX: 100, preventDefault() { this.defaultPrevented = true; } });
  assert.equal(field.value, "", "a left-side tap is an ordinary tap");

  // A tap in the last strip is the drawn arrow.
  const inZone = { target: field, clientX: 292, preventDefault() { this.defaultPrevented = true; } };
  root.fire("pointerdown", inZone);
  assert.equal(field.value, "2");
  assert.equal(field.focused, false,
    "no focus, so the phone keyboard cannot slide up and shift the page under the next tap");
  assert.equal(inZone.defaultPrevented, true);

  // The strip runs 52px deep on a 200px field, so a thumb landing a little wide
  // of the drawn arrow still counts.
  const wide = new FakeField({ suggest: "2", rect: { width: 200, right: 300 } });
  root.fire("pointerdown", { target: wide, clientX: 255, preventDefault() {} });
  assert.equal(wide.value, "2", "the strip is generous around the drawn arrow");
});

test("either reading can find the arrow, and both must miss for a tap to be ordinary", () => {
  const root = fakeRoot();
  installSuggestionAccept(root);
  const box = { clientWidth: 200, rect: { width: 200, right: 300 } };

  // A phone page that has panned (its keyboard opened under the thumb) can report
  // a page coordinate that no longer matches where the field is drawn. The
  // field's own offset still reads true, so the tap counts.
  const panned = new FakeField({ suggest: "2", ...box });
  root.fire("pointerdown", { target: panned, offsetX: 180, clientX: 40, preventDefault() {} });
  assert.equal(panned.value, "2", "the field's own reading takes the tap when clientX is stale");

  // The plain reading still works on its own — an event with no usable offset.
  const noOffset = new FakeField({ suggest: "2", ...box });
  root.fire("pointerdown", { target: noOffset, clientX: 292, preventDefault() {} });
  assert.equal(noOffset.value, "2", "a right-edge tap counts without an offset reading");

  // Only a tap that misses the strip on BOTH readings is an ordinary tap.
  const ordinary = new FakeField({ suggest: "2", ...box });
  root.fire("pointerdown", { target: ordinary, offsetX: 20, clientX: 100, preventDefault() {} });
  assert.equal(ordinary.value, "", "a left-side tap on both readings is an ordinary tap");

  // The strip is never narrower than a thumb: 30px even on a cramped field.
  const narrow = new FakeField({ suggest: "2", clientWidth: 100, rect: { width: 100, right: 300 } });
  root.fire("pointerdown", { target: narrow, offsetX: 75, preventDefault() {} });
  assert.equal(narrow.value, "2", "30px strip on a narrow field");
  const narrowMiss = new FakeField({ suggest: "2", clientWidth: 100, rect: { width: 100, right: 300 } });
  root.fire("pointerdown", { target: narrowMiss, offsetX: 60, preventDefault() {} });
  assert.equal(narrowMiss.value, "", "still an ordinary tap further left");
});

test("a click lands the same way, and cannot double-accept", () => {
  const root = fakeRoot();
  installSuggestionAccept(root);
  // Browsers without pointer events (older iOS) only send the click.
  const field = new FakeField({ suggest: "2", clientWidth: 200, rect: { width: 200, right: 300 } });
  root.fire("click", { target: field, offsetX: 190 });
  assert.equal(field.value, "2");
  assert.deepEqual(field.events, ["input", "change"], "accepted exactly once");

  // A pointerdown that already took the value leaves the follow-up click nothing
  // to do — so no second input/change pair fires.
  const both = new FakeField({ suggest: "2", clientWidth: 200, rect: { width: 200, right: 300 } });
  root.fire("pointerdown", { target: both, offsetX: 190, preventDefault() {} });
  root.fire("click", { target: both, offsetX: 190 });
  assert.equal(both.value, "2");
  assert.deepEqual(both.events, ["input", "change"], "a tap is not accepted twice");
});

test("the installed listeners can be removed again", () => {
  const root = fakeRoot();
  const remove = installSuggestionAccept(root);
  remove();
  const field = new FakeField({ suggest: "2", clientWidth: 200 });
  root.fire("keydown", keyEvent(field, "ArrowRight"));
  root.fire("pointerdown", { target: field, offsetX: 190, preventDefault() {} });
  root.fire("click", { target: field, offsetX: 190 });
  assert.equal(field.value, "", "after removal the gesture is gone");
});

// ── the safety rule ────────────────────────────────────────────────────────
// Walk a source file's `el("input", { … })` call that carries `placeholder: "<ph>"`
// and return that whole call, skipping string literals so a parenthesis inside a
// placeholder (e.g. "anon public key (eyJ…)") cannot unbalance the scan.
function callBlock(src, ph) {
  const at = src.indexOf(`placeholder: "${ph}"`);
  assert.ok(at >= 0, `expected a field with placeholder ${ph}`);
  const start = src.lastIndexOf("el(", at);
  let depth = 0;
  let quote = "";
  let i = start;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") { i += 1; continue; }
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "(" || c === "{") depth += 1;
    else if (c === ")" || c === "}") { depth -= 1; if (depth === 0) { i += 1; break; } }
  }
  return src.slice(start, i);
}

test("credential fields never offer an arrow-acceptable suggestion", () => {
  const files = {
    "admin/js/views/settings.js": [
      "https://xxxx.supabase.co", "anon public key (eyJ…)", "you@example.com", "app login password",
    ],
    "admin/js/views/login.js": [
      "https://xxxx.supabase.co", "anon public key (eyJ…)", "you@example.com", "app login password",
    ],
  };
  for (const [path, placeholders] of Object.entries(files)) {
    const src = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    for (const ph of placeholders) {
      const block = callBlock(src, ph);
      assert.ok(!block.includes("data-suggest"),
        `${path}: "${ph}" must not be arrow-acceptable (it is not a recommendation)`);
    }
  }
});
