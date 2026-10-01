// test/keep-still.test.js — the anchor-and-delta rule itself (admin/js/ui.js, v255).
//
// WHY THIS FILE EXISTS. `keepStill`/`scrollerFor` were born inside `courierQuoteSection` at
// v254 to stop the ＋ New order card growing under her finger. Her next report — "when i say
// look this address up, why the interface jump out of the page?" — was the pin picker's own
// "Look it up", which needed the identical correction and had none of it. Rather than write
// the rule twice, it moved to ui.js and both screens now call it.
//
// That makes it LOAD-BEARING FOR TWO SCREENS while having had no test of its own. The two
// screen tests can only ever see their own symptom; this file is about the rule, so that the
// next screen to need it inherits something that is known to work rather than something that
// merely looks right.
//
// WHAT THE SHIM IS, AND WHAT IT IS NOT. `keepStill` touches exactly four things: an element's
// `getBoundingClientRect().top`, its `isConnected`, its parent chain, and a scroller's
// `scrollTop`. All four are modelled below, and the rect is computed from a layout the test
// sets by hand — which is the whole point, because the rule is arithmetic about a rect that
// moves. It is NOT a browser: it does not do layout, so a test here must SAY how far the
// anchor moved rather than expect the shim to work it out. That is honest rather than a
// weakness — the number the rule acts on is the number the test states.

import { test } from "node:test";
import assert from "node:assert/strict";

// ── the shim ───────────────────────────────────────────────────────────────
//
// `top` is the anchor's own viewport top. `onRun` is fired while `fn` is inside `keepStill`,
// which is how a test says "the repaint happened and the anchor moved": there is no other
// moment at which a real layout would change it.
function makeEl({ top = 0, parent = null, connected = true, className = "" } = {}) {
  return {
    nodeType: 1, className, parentNode: parent, isConnected: connected,
    top,
    scrollTop: 0,
    getBoundingClientRect() { return { top: this.top, bottom: this.top, left: 0, right: 0, width: 0, height: 0 }; },
  };
}

// A node with NO layout at all — a stand-in screen, or a phone whose node has gone.
function makeBareEl() {
  return { nodeType: 1, className: "", parentNode: null, isConnected: true };
}

const documentScroller = makeEl();
globalThis.document = {
  createElement: () => makeEl(),
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  scrollingElement: documentScroller,
  documentElement: documentScroller,
};

const { keepStill, scrollerFor } = await import("../admin/js/ui.js");

// A pop-up body, with a node somewhere inside it — the picker's map box, and the door block in
// the Edit pop-up, both live this way.
function inPopup(anchor) {
  const body = makeEl({ className: "popup-body" });
  const mid = makeEl({ className: "field", parent: body });
  anchor.parentNode = mid;
  return body;
}

// ── the correction ─────────────────────────────────────────────────────────

test("an anchor that moves down the screen is put back by scrolling its container (v255)", () => {
  const anchor = makeEl({ top: 306 });
  const body = inPopup(anchor);

  keepStill(anchor, () => { anchor.top = 575; });

  assert.equal(body.scrollTop, 269,
    "the container scrolled by exactly the distance the anchor moved, which is what 'the interface jumped' means in numbers");
  assert.equal(documentScroller.scrollTop, 0,
    "and the document was not touched — the anchor lives in the pop-up, so the pop-up is what moves");
});

test("an anchor that moves UP is corrected in the other direction, without a floor", () => {
  const anchor = makeEl({ top: 575 });
  const body = inPopup(anchor);
  body.scrollTop = 300;

  keepStill(anchor, () => { anchor.top = 306; });

  assert.equal(body.scrollTop, 31,
    "269 pixels came off the scroll — a rule that can only ever scroll one way is half a rule");
});

test("a repaint that does not move the anchor does not move the page either", () => {
  const anchor = makeEl({ top: 306 });
  const body = inPopup(anchor);
  body.scrollTop = 140;

  keepStill(anchor, () => { /* redrew, changed nothing above the anchor */ });

  assert.equal(body.scrollTop, 140,
    "no delta means no correction: scrolling anyway would be the jump this rule exists to prevent");
});

// ── which container actually scrolls ───────────────────────────────────────

test("the pop-up body is found by walking up, not by asking the document (v255)", () => {
  const anchor = makeEl({ top: 0 });
  const body = inPopup(anchor);

  assert.equal(scrollerFor(anchor), body,
    "a `.popup-body` ancestor is the scroller, however many nodes sit between it and the anchor");

  const loose = makeEl({ top: 0, parent: makeEl({ className: "view" }) });
  assert.equal(scrollerFor(loose), documentScroller,
    "and a node in the page at large falls back to the document — the ＋ New order card's own case");
});

test("a correction lands on the pop-up body and NOT on the document behind it (v255)", () => {
  const anchor = makeEl({ top: 306 });
  const body = inPopup(anchor);

  keepStill(anchor, () => { anchor.top = 575; });

  // Both scrollers are live here, and only one of them may move. A rule that reached for
  // `document.scrollingElement` on every screen would look right on the inline card — where
  // that IS the scroller — and scroll the page BEHIND a pop-up on the two cards that are not.
  assert.equal(body.scrollTop, 269, "the pop-up scrolled");
  assert.equal(documentScroller.scrollTop, 0, "and the page behind it did not");
});

// ── the cases that must be quiet rather than throw ─────────────────────────

test("a node with no layout still runs the repaint, and corrects nothing", () => {
  const anchor = makeBareEl();
  inPopup(anchor);
  let ran = false;

  keepStill(anchor, () => { ran = true; });

  assert.equal(ran, true,
    "the repaint is the point of the call, so it must happen on a screen that cannot be measured");
});

test("an anchor that has left the page is not corrected, and does not throw", () => {
  const anchor = makeEl({ top: 306 });
  const body = inPopup(anchor);

  keepStill(anchor, () => { anchor.isConnected = false; anchor.top = 575; });

  assert.equal(body.scrollTop, 0,
    "a node that left the page has no viewport position to defend, so the rule declines rather than scrolling to a number it just made up");
});

test("no anchor at all is the same as no layout: run it, correct nothing", () => {
  let ran = false;
  keepStill(null, () => { ran = true; });
  keepStill(undefined, () => { ran = true; });
  assert.equal(ran, true, "a call site that has no anchor to hand must still be able to repaint");
});
