// test/store-offer-strip.test.js — the shop's standing offer strip must not change height
// while its offers turn.
//
// THE FAULT THIS FILE GUARDS (v292, fixed v295). v292 wrote each running offer into ONE
// pair of lines as the turn came round, so the strip was exactly as tall as the message it
// happened to be showing. Two codes where only one carries a sentence of her own are two
// different heights — so every turn made the whole page below the strip jump. Her words:
//
//   "when the message switch, the page is like jumping up and down repeatedly…
//    The window should be fix, base on the tallest message."
//
// THE FIX IS TWO DECLARATIONS, and they are the whole of it: every offer is a slide, and
// every slide is placed in the SAME grid cell. A grid row is as tall as its tallest item,
// so the strip is permanently as tall as the TALLEST message — worked out by the browser,
// at whatever font, language and text size the customer actually has, with no measurement
// of ours that can go stale.
//
// A layout fault needs a browser to see, so this file holds the MECHANISM in place and
// `marketing/harness-v295.html` measures the actual height across a run of turns. Neither
// is sufficient alone: the CSS could be right and the script still redraw into one line,
// which is precisely what v292 did.
//
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const url = (p) => new URL(`../${p}`, import.meta.url);
const css = readFileSync(url("store/app.css"), "utf8");
const html = readFileSync(url("store/index.html"), "utf8");
const app = readFileSync(url("store/app.js"), "utf8");

test("every offer shares one grid cell, so the strip cannot change height", () => {
  const rotor = css.match(/\.promo-rotor\s*\{[^}]*\}/);
  assert.ok(rotor, "app.css has no .promo-rotor rule");
  assert.match(rotor[0], /display:\s*grid/,
    "the rotor must be a grid — without it the slides stack in normal flow and the strip grows to hold all of them");

  const slide = css.match(/\.promo-slide\s*\{[^}]*\}/);
  assert.ok(slide, "app.css has no .promo-slide rule");
  assert.match(slide[0], /grid-area:\s*1\s*\/\s*1/,
    "every slide must land in the SAME cell — that is the one thing making the tallest message decide the height");
  assert.match(slide[0], /transition:[^;]*opacity/,
    "the offer has to fade as well as turn, or a half-turned one reads through the other");
});

test("the turn is a 3D flip: the two panels go out by OPPOSITE doors", () => {
  // Her asks, in order: "can the flip be an animation", then "the flip should be 3D flip".
  // v296 failed the second one: it sent BOTH panels through the same arc (old 0 → −90, new
  // −90 → 0), which mirrors them the whole way and reads as a vertical squash.
  const rotor = css.match(/\.promo-rotor\s*\{[^}]*\}/)[0];
  assert.match(rotor, /perspective:/,
    "without a perspective on the rotor the turn is flat and reads as a squash, not a flip");

  const slide = css.match(/\.promo-slide\s*\{[^}]*\}/)[0];
  assert.match(slide, /transform:\s*rotateX\(90deg\)/,
    "an offer waiting its turn rests edge-on BELOW the reader");
  assert.match(slide, /transition:[^;]*transform/,
    "the turn itself must be a transition on transform");

  const lit = css.match(/\.promo-slide\.is-on\s*\{[^}]*\}/);
  assert.ok(lit, "the lit slide has no rule of its own");
  assert.match(lit[0], /transform:\s*rotateX\(0deg\)/,
    "the lit offer faces the reader");

  // ⚠️ THE OPPOSITE DOOR, and the whole of what makes it read as 3D. Remove this rule and
  // the two panels mirror each other through one arc again — the squash v296 shipped.
  const left = css.match(/\.promo-slide\.is-left\s*\{[^}]*\}/);
  assert.ok(left, "nothing sends the replaced offer out the other door — that rule IS the 3D flip");
  assert.match(left[0], /transform:\s*rotateX\(-90deg\)/,
    "the offer that has just been replaced must tip AWAY over the top, not back the way it came");
  assert.equal(left[0].includes("opacity"), false,
    "the leaving slide must not carry an opacity of its own — it fades on the base rule, fast");

  // It has to win over the base rule on its own: more specific, and later in the sheet.
  assert.equal(
    css.lastIndexOf(".promo-slide.is-left") > css.lastIndexOf("\n.promo-slide {"),
    true, "the .is-left rule must come after the base .promo-slide rule");

  // And the two directions still fade at different rates — both panels are on screen at
  // once, and equal fades would put two half-turned messages up together.
  const outOpacity = slide.match(/opacity\s+([\d.]+)s/);
  // `opacity .3s ease .14s` — the easing word sits between the duration and the delay.
  const inRule = lit[0].match(/opacity\s+([\d.]+)s(?:\s+[a-z-]+)?(?:\s+([\d.]+)s)?/);
  assert.ok(outOpacity, "the leaving slide has no opacity timing");
  assert.ok(inRule, "the arriving slide has no opacity timing");
  assert.equal(Number(inRule[2] || 0) > 0, true,
    "the arriving slide must DELAY its fade — without the delay both offers are half-visible mid-turn");
  assert.equal(Number(outOpacity[1]) < Number(inRule[1]), true,
    "the leaving slide must fade FASTER than the arriving one comes up");
});

test("there is one dot per offer, and none for a single offer", () => {
  // Her ask: "there should be 2 dot if there is 2 message, 3 dot if 3 message."
  assert.match(html, /<div id="promo-dots"[^>]*><\/div>/,
    "index.html must carry an empty #promo-dots for the script to fill");
  assert.match(app, /dots = list\.map\(/,
    "the dots must be built one per offer, from the same list the slides come from");
  // A row of dots that a single offer does not need — the same rule that leaves the timer
  // unarmed, and the :empty rule is what keeps an empty row from adding height.
  assert.match(css, /\.promo-dots:empty\s*\{\s*display:\s*none/,
    "an empty dot row must not take up space");
});

test("the dots meet the accessibility floor the house skill sets", () => {
  // ⚠️ THE FIRST DRAFT SHIPPED 22px HIT AREAS — under WCAG 2.5.8's 24×24 CSS px floor.
  // These are the rules that were missing, held here so they cannot quietly go again.
  const dot = css.match(/\.promo-dot\s*\{[^}]*\}/);
  assert.ok(dot, "app.css has no .promo-dot rule");
  const size = (prop) => {
    const m = dot[0].match(new RegExp(`${prop}:\\s*(\\d+)px`));
    return m ? Number(m[1]) : 0;
  };
  assert.equal(size("width") >= 24, true,
    `the dot's hit area must clear WCAG 2.5.8's 24px floor (it is ${size("width")}px)`);
  assert.equal(size("height") >= 24, true,
    `…in both directions (height is ${size("height")}px)`);

  // A control must say what it is to a screen reader, and this one is a button with no text.
  assert.match(app, /"aria-label": `\$\{i \+ 1\} \/ \$\{list\.length\}`/,
    "each dot needs its own aria-label — it is an icon-only button");

  // A visible focus ring: the house skill forbids `outline: none` without a replacement,
  // and these are keyboard-reachable buttons.
  assert.match(css, /\.promo-dot:focus-visible\s*\{[^}]*outline:/,
    "the dots are reachable by keyboard and must show where the focus is");
});

test("the motion follows the house rules for durations and easings", () => {
  // The house skill: 250–400ms for a page-level state change, never over 500ms; and
  // ease-out for entering, ease-in for leaving.
  const slide = css.match(/\.promo-slide\s*\{[^}]*\}/)[0];
  const lit = css.match(/\.promo-slide\.is-on\s*\{[^}]*\}/)[0];
  const dur = (rule) => Number((rule.match(/transform\s+([\d.]+)s/) || [])[1] || 0);
  assert.equal(dur(slide) > 0 && dur(slide) <= 0.5, true,
    `the turn must stay inside the house ceiling of 500ms (it is ${dur(slide)}s)`);
  assert.equal(dur(lit), dur(slide),
    "the two halves of one turn must take the same time, or the swap looks like a stumble");

  // ease-in leaves, ease-out arrives. Both are cubic-beziers, so the first control point
  // tells them apart: an ease-out starts fast (x1 ≈ 0) and an ease-in starts slow (x1 high).
  const leaveX1 = Number((slide.match(/cubic-bezier\(([\d.]+),/) || [])[1]);
  const enterX1 = Number((lit.match(/cubic-bezier\(([\d.]+),/) || [])[1]);
  assert.equal(enterX1 < leaveX1, true,
    "the arriving offer should ease OUT (starts fast) and the leaving one ease IN (starts slow)");
});

test("a press on the strip can no longer freeze the turn for ever", () => {
  // ⚠️ HER REPORT: "once we put mouse over it or click it, the flip stop… move the mouse
  // outside the window, the flip should be back." v292 paused on any `pointerdown` for
  // twenty seconds — a CLOCK, not the pointer — so a click trapped the strip and moving
  // away could not release it. The pointer being over the strip is the whole of the pause.
  assert.doesNotMatch(app, /PRESS_HOLD_MS/,
    "the twenty-second press-hold is back — it traps the strip on any click");
  assert.doesNotMatch(app, /heldUntil/,
    "a clock-based hold is back; the pause must be the pointer being over the strip, and nothing else");
  assert.match(app, /promoToday\.addEventListener\("pointerleave", \(\) => \{ overStrip = false; \}\)/,
    "leaving the strip must release the turn");
});

test("only the lit slide can be tapped", () => {
  // The unlit slides are stacked behind the lit one and cover the same box, so an
  // unlit slide left interactive would swallow a press meant for the strip.
  const slide = css.match(/\.promo-slide\s*\{[^}]*\}/)[0];
  assert.match(slide, /pointer-events:\s*none/);
  const lit = css.match(/\.promo-slide\.is-on\s*\{[^}]*\}/);
  assert.ok(lit, "the lit slide has no rule of its own");
  assert.match(lit[0], /pointer-events:\s*auto/);
});

test("the strip ships empty, so a static copy of an offer cannot defeat the stacking", () => {
  const block = html.match(/<div id="promo-rotor"[^>]*>[\s\S]*?<\/div>/);
  assert.ok(block, "index.html has no #promo-rotor element");
  assert.doesNotMatch(block[0], /<p\b/,
    "the rotor must start empty — a line written into the markup would be a second copy of an offer the script is about to draw");
});

test("nothing draws an offer into a single shared line any more", () => {
  // The v292 mechanism, named so a future edit cannot quietly bring it back. If the script
  // writes text into one element per line again, the height is once more whatever that
  // message happens to be — and the CSS above cannot save it.
  assert.doesNotMatch(app, /promoOffer\.textContent\s*=/,
    "the offer must be drawn once per slide, at build time — not rewritten into one line as the turn comes round");
  assert.doesNotMatch(app, /promoWords\.textContent\s*=/,
    "same for her own sentence");
  assert.doesNotMatch(app, /is-fading/,
    "the old JS-driven fade is gone: the cross-fade is the CSS transition on .promo-slide now");
});

test("the script rotates by lighting a slide, and the timer is her 1.5 seconds", () => {
  assert.match(app, /const TURN_MS = 1500;/,
    "she asked for a flip every 1.5 seconds");
  assert.match(app, /showSlide\(standingNext\(/,
    "the timer must move which slide is lit, and nothing else");
});
