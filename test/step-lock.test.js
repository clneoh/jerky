// test/step-lock.test.js — the shop is walked IN ORDER, and a step that is shut says WHY (v454, v456).
//
// HER WORDS, and they are the whole of this file:
//   v452: __"when we proceed order step by step, one after another, if the previous step not completed
//          user should be inform accordingly"__
//   v454: __"where is the implementation of one step after another? have you check. this is the second
//          time i ask"__
//   v456: __"i skip step 2 and filled up step 3, it should not allow me to do step 3 at all?"__ …
//         __"lock the 2 delivery cards too"__
//
// ⚠️⚠️ TWICE I BUILT HALF OF IT. v454 built the step-1 lock and stopped. v456's first half locked the
// two boxes she NAMED and left the two CARDS beside them pressable — **the same shape of mistake in the
// same instruction, read too narrowly both times.** ⭐ "One step after another" is a rule about a STEP,
// and every control inside a step is part of it.
//
// ⚠️ AND TWO MISTAKES ARE PINNED HERE RATHER THAN ONLY FIXED, because both were silent:
//
//   1. **THE MESSAGE MUST LAND AT THE STEP IT IS ABOUT.** v455 fixed her complaint __"the message show in
//      the wrong place"__ by putting a line under the step — but there was only ever ONE step raising a
//      refusal, so nothing forced the line to be addressed. ⚠️ **The moment a second step can refuse, a
//      sentence about step 2 printed under step 1 IS the fault v455 repaired.** `stepId` was passed to
//      `sayStepFirst` and thrown away (`void stepId`) — it was accepted and never used.
//
//   2. **A SHUT CONTROL ANSWERS; IT IS NOT SWITCHED OFF.** The shop's own test already settles this —
//      *"the button is dead on an empty basket again — it must answer instead"* — because **a disabled
//      control on a phone does not even acknowledge the tap**, so a customer is told nothing at all.
//
// ⚠️ NO TEST CAN SEE WHERE A NODE SITS ON SCREEN (the v388 lesson, and the reason shop-info-card.test.js
// pins a RULE rather than a layout). So this file pins the two rules that decide it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../store/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../store/index.html", import.meta.url), "utf8");

// The steps the PAGE actually has. Read from the markup rather than listed here, so a refusal addressed
// to a step the shop does not draw cannot pass.
const HEADS = [...html.matchAll(/class="step-head" id="(step\d+)"/g)].map((m) => m[1]);
// Every refusal raised anywhere in the shop, with the step it says it belongs to.
// ⚠️ THE FOURTH ARGUMENT IS OPTIONAL (v459) — the thing that refused, so the line can be put next to it.
// A pattern that demanded the closing bracket straight after the step would have gone quietly blind to
// every call that names a place to speak, which is the "a check keyed to one shape checks one shape" trap.
const CALLS = [...app.matchAll(/sayStepFirst\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"(step\d+)"\s*[,)]/g)];

test("★★ every refusal is addressed to a step the page actually draws (v456, v493)", () => {
  assert.ok(HEADS.length >= 3, `the page's steps were not found at all (found ${HEADS.join(", ")}), so this proves nothing`);
  assert.ok(CALLS.length >= 2, `no refusal names its step (found ${CALLS.length}), so this proves nothing`);

  for (const [, title, body, step] of CALLS) {
    assert.ok(HEADS.includes(step),
      `★ a refusal ("${title}"/"${body}") is sent to "${step}", which the shop does not draw — it would print wherever the line happens to sit`);
  }

  // ★★★ AND SINCE v493 A REFUSAL CANNOT NAME A STEP AT ALL — IT NAMES THE FIRST ONE MISSING.
  // Her words: __"when step 1 is skip, it should always go back to step1"__. ⚠️⚠️ Before this, each refusal
  // was addressed to the step its own control lived in: a customer with no bake day who pressed a DELIVERY
  // CARD was sent to step 2, and one who pressed PLACE ORDER was sent to step 2 as well — **told about the
  // basket while the bake day was the thing he had not done, with the circles beside it saying step 1.**
  // ⭐ So the guard is now: every step→words pair is present, every step is one the page draws, and the
  // three refusals that used to hard-code a step go through the one answer.
  const say = app.slice(app.indexOf("const STEP_SAY = {"), app.indexOf("function refuseAtFirstMissing"));
  assert.ok(say.length > 0, "the step → words table is gone, so a refusal has nothing to say");
  for (const [step, title, body] of [
    ["step1", "needDayTitle", "needDayBody"],
    ["step2", "needItemTitle", "needItemBody"],
    ["step3", "fulfilAskTitle", "fulfilAskBody"],
  ]) {
    assert.ok(HEADS.includes(step), `the table names "${step}", which the page does not draw`);
    assert.match(say, new RegExp(`["']?${step}["']?\\s*:\\s*\\["${title}", "${body}"\\]`),
      `★ "${step}" no longer has its own words — the step that is missing would be described by another `
      + `step's sentence`);
  }
  // ⚠️ AND THE REFUSALS THAT USED TO NAME A STEP NOW ASK. These three are the ones measured going to the
  // WRONG step before this version: the two delivery cards, the two step-3 boxes, and Place order.
  for (const want of [
    /_refuseWay\s*=\s*\(\)\s*=>\s*refuseAtFirstMissing\(\)/,
    /const sayWhyNotYet = \(\) => \{\s*if \(cart\.size > 0\) return;[^}]*refuseAtFirstMissing\(\);/,
  ]) {
    assert.match(app, want,
      "★ a refusal that names a step of its own is back — it can answer about a later step than the one "
      + "that is actually missing");
  }
  assert.match(app, /if \(!lines\.length\) \{[\s\S]{0,900}?refuseAtFirstMissing\(\);/,
    "★ Place order no longer asks which step is first missing, so it can answer about the basket while the "
    + "bake day is the thing outstanding");
  // ⭐ AND THE CIRCLES AND THE SENTENCE READ ONE RULE, which is the only way they cannot disagree.
  assert.match(app, /function stepsDone\(\)/,
    "★ the done-ness of the three steps is computed in more than one place again — the circles and the "
    + "refusal can drift apart about one order");
  assert.match(app, /function firstMissingStep\(\) \{\s*const done = stepsDone\(\);/,
    "★ the refusal no longer asks the same question the circles do");
});

test("★★ the line is PLACED at that step — `stepId` is not accepted and thrown away (v456)", () => {
  // ⚠️⚠️ IT WAS EXACTLY THAT UNTIL v456: `void stepId;` sat at the top of the function with a comment
  // explaining why it did not matter. It mattered the moment a second step could speak.
  assert.doesNotMatch(app, /void stepId/,
    "★ the step is being discarded again (`void stepId`) — every refusal then prints under whichever step the line happens to sit beneath");

  const from = app.indexOf("function sayStepFirst(");
  const to = app.indexOf("let avail = null;");
  assert.ok(from >= 0 && to > from, "the refusal helper could not be located, so this proves nothing");
  const fn = app.slice(from, to);
  assert.match(fn, /insertBefore/,
    "★ the line is no longer MOVED to the step it is about — a step-2 sentence would print under step 1");
  // ⚠️ IT LOOKS UP THE STEP'S **FIELD**, NOT ITS HEADING (v493) — her refinement, in her words: __"the
  // field and steps should be in sequence, the appropriate warning should be below that field"__. ⭐ The
  // lookup is `STEP_FIELD[stepId]`, and this asserts the line is addressed by the step it names rather than
  // printing wherever it happens to sit — which is what `stepId` was accepted and thrown away for at v456.
  assert.match(fn, /getElementById\(STEP_FIELD\[stepId\]/,
    "★ the refusal no longer looks up the step it names, so the movement above is proof of nothing");
  // ⚠️ AND STEP 3 POINTS AT THE TWO CARDS, NOT AT THE WHOLE CARD (v493). Her words: __"step3 is a big step,
  // can be a very tall step window, then it shold go by field."__ ⭐ `step3-body` was the first anchor and it
  // was WRONG for exactly that reason: the foot of the tall card is a screen and a half below the thing he
  // has to tap.
  assert.match(app, /const STEP_FIELD = \{ step1: "dates", step2: "menu", step3: "fulfillment" \}/,
    "★ the step → field map is gone or has changed shape: every line would fall back to the step heading, "
    + "which is not where the thing that is missing lives");
  assert.doesNotMatch(app, /step3-body/,
    "★ step 3 is anchored at the foot of the whole card again — the tall-step fault");
});

test("★★★ there is ONE way a step refuses, and the page goes to it (v493)", () => {
  // Her words, and they are the whole of v493: __"no matter the user is clicking on step 2, step3 or step 4,
  // the screen should scroll to step1, and below step one flashing the warning meaasge … Any other warning
  // message serve the purpose if not behave in such a way should be retired"__
  // ⚠️ FROM `bringIntoView`, NOT FROM `sayStepFirst` — the moving is its own small function beside the
  // helper, and a slice that started at the helper would miss the very thing this test is about.
  const from = app.indexOf("function bringIntoView(");
  const to = app.indexOf("let avail = null;");
  assert.ok(from >= 0 && to > from, "the refusal helper could not be located, so this proves nothing");
  const fn = app.slice(from, to);

  // ⭐ IT MOVES THE PAGE — and only after asking whether it needs to.
  assert.match(fn, /scrollIntoView/,
    "★ the refusal no longer carries the page to the step it names — the customer is told off out of sight, "
    + "which is the fault this whole thread has been about (measured twice: 262px, then 825px, off screen)");
  assert.match(fn, /getBoundingClientRect/,
    "★ it moves the page WITHOUT looking: a customer already looking straight at the step being named gets "
    + "thrown up the page for nothing — the fault v423 settled for the parked place");
  assert.match(fn, /previousSibling/,
    "★ the line no longer checks whether it is already under the right heading, so it re-inserts every time");

  // ⚠️⚠️ AND IT IS NO LONGER PUT BESIDE WHATEVER HE TOUCHED. `near` took the control that refused and hung
  // the line above it — ⭐ that is what put the line INSIDE the menu (v459), which the menu's own rebuild then
  // threw away (v460), and v493 retired the whole arrangement along with the machinery that repaired it.
  // ⚠️⚠️ ASKED AS THE FACT, NOT AS A NAME — the retirement is explained in a comment right where the
  // machinery used to live, and a test keyed to the identifier would trip on its own history. **What must
  // never come back is the line being hung INSIDE the menu**, because that is the thing a rebuild throws
  // away (v460). ⭐ `placeStepNote = (` is how the machinery was defined; this is the shape of it coming back.
  assert.doesNotMatch(app, /menu\.insertBefore\(\s*stepNoteEl/,
    "★ the refusal line is being hung back inside the menu, where a rebuild can throw it out of the page");
  assert.doesNotMatch(app, /placeStepNote\s*=\s*\(/,
    "★ the re-hanging machinery is back — which means the line is living somewhere a repaint replaces");
  assert.doesNotMatch(fn, /\bnear\b/,
    "★ the refusal is being told where to speak — the line belongs to the STEP, not to the control he touched");

  // ⭐ AND THE THREE OLD SURFACES ARE GONE. Every refusal that names a step uses this one line now.
  for (const key of ["needItemTitle", "confirmAddWaTitle", "confirmClosedTitle"]) {
    const at = app.indexOf(`"${key}"`);
    assert.ok(at > 0, `${key} vanished from the shop altogether — this test is no longer watching it`);
    assert.doesNotMatch(app.slice(at - 200, at + 200), /showConfirm/,
      `★ "${key}" is shown by the foot-of-page banner again — one refusal, one surface`);
  }
  // ⚠️ The closed day is step 1's problem, so it speaks at step 1 — and its words are BUILT (the cut-off
  // time is substituted in), which is why the helper takes the sentence as well as the keys.
  assert.match(app, /sayStepFirst\("confirmClosedTitle", "confirmClosedBody", "step1"/,
    "★ the day that closed no longer speaks at step 1, though picking a new day IS step 1's instruction");
  // ⚠️ And the number box answers the way the name box does — through the field, not the banner.
  assert.match(app, /markField\(waInput, "confirmAddWaTitle", "confirmAddWaBody"\)/,
    "★ the number box has gone back to being told off somewhere else, while the box above it marks itself");
});

test("★ the line goes when the step IT names is done — not when some other step is (v493)", () => {
  // ⚠️⚠️ THE CLEARING TEST USED TO BE `dayPicked` — **which is only step 1's question.** ⭐ That was right
  // while step 1 was the only step that could refuse. The moment the line can speak about step 2 or step 3,
  // **a customer who had already picked his day would have the answer to a step-2 refusal wiped by the next
  // repaint.** v455's rule is kept and scoped to what it was always about: a form error does not outlive
  // ITS cause — the step it names.
  const paint = app.slice(app.indexOf("function paintSteps()"), app.indexOf("function paintSteps()") + 4200);
  assert.match(paint, /stepNoteStep/,
    "★ the clearing no longer asks which step the line is speaking about, so a step-1 answer is wiped by a "
    + "step-2 repaint (and the other way round)");
  // ⚠️⚠️ `done\[[^\]]*\]` WOULD HAVE BEEN VACUOUS — `paintSteps` is full of `done[i]` for the circles, so an
  // alternation that accepted any subscript kept passing when the clearing was put back on `dayPicked`.
  // ⭐ MEASURED: bitten with `dayPicked`, this test stayed green. The subscript has to be NAMED.
  assert.match(paint, /done\[speakingAbout\]/,
    "★ the clearing no longer consults whether the step IT NAMES is done");
});

test("★ the two delivery cards REFUSE on an empty basket — they are not switched off (v456)", () => {
  // ⚠️⚠️ v452'S RULE, and this repo has paid for it: a disabled control on a phone takes the tap and
  // answers NOTHING. The two cards stay live and say why.
  assert.match(app, /_mayChooseWay\s*=\s*\(\)\s*=>\s*cart\.size > 0/,
    "★ the picker is no longer told whether the basket has anything in it, so the two cards choose a way for an empty order");
  assert.match(app, /_mayChooseWay\s*&&\s*![\w.]*_mayChooseWay\(\)/,
    "★ the refusal is wired up but never asked on the press");
  assert.match(app, /_refuseWay\s*=/,
    "★ the refusal has nothing to say when it fires, so a press would be answered with silence");
  // ⚠️ AND IT IS THE PRESS, NOT `apply` — `apply` also carries the SHOP'S OWN state changes (the
  // start-up default and the after-order reset), both of which run with an EMPTY basket. A guard in
  // there would tell a customer who has just placed an order to add something first.
  const press = app.slice(app.indexOf("const pressWay = (want) => {"));
  const pressBody = press.slice(0, press.indexOf("\n  };"));
  assert.match(pressBody, /_mayChooseWay/,
    "★ the guard left the press — `apply` runs on an empty basket by design and would refuse the shop itself");
});
