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

test("★★ every refusal is addressed to a step the page actually draws (v456)", () => {
  assert.ok(HEADS.length >= 3, `the page's steps were not found at all (found ${HEADS.join(", ")}), so this proves nothing`);
  assert.ok(CALLS.length >= 2, `no refusal names its step (found ${CALLS.length}), so this proves nothing`);

  for (const [, title, body, step] of CALLS) {
    assert.ok(HEADS.includes(step),
      `★ a refusal ("${title}"/"${body}") is sent to "${step}", which the shop does not draw — it would print wherever the line happens to sit`);
  }
  // ⚠️ AND THE ONE THE WHOLE VERSION TURNS ON: the empty-basket refusal belongs to STEP 2, because the
  // basket is what step 2 is for. Sending it to step 3 (where the customer's thumb is) would put the
  // sentence under the step that is not the missing one, which is the v455 fault again.
  assert.ok(CALLS.some(([, , , step]) => step === "step2"),
    "★ nothing refuses at step 2 any more, so the empty-basket guard is gone or was re-pointed");
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
  assert.match(fn, /getElementById\(stepId\)/,
    "★ the refusal no longer looks up its own step, so the movement above is proof of nothing");
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
