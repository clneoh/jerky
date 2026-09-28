// test/guarded-press.test.js — a press must not be able to leave its button dead (v217).
//
// couriers/api.js promises that a call never throws, because "a thrown error [at a button in
// a pop-up she pressed while standing in a kitchen] is a dead screen with no words on it".
// That promise covers the CHANNEL. The guard in front of the channel — `busy`, `jobBusy` —
// is the screen's own, and every press in the two courier screens set it before its first
// await and cleared it again on each way out it knew about. An exit it did not know about
// left it set, and a set guard returns every later press at once, with nothing said, on a
// button still grey. That is a dead control, and it is the shape of fault the baker reported
// as "the get price from lalamove not responding".
//
// The mechanism that ends it is `guarded` (admin/js/ui.js), and it is ONE function, so this
// file tests it directly — plus `saidOf`, the sentence a thrown value is said with. The two
// screens that reported the fault are driven for real in no-null-text.test.js, where the
// courier card is already rendered, and in delivery-run.test.js.
//
// The fault sweep for this version flips each of these back and watches them go red.

import { test } from "node:test";
import assert from "node:assert/strict";

const { guarded, saidOf } = await import("../admin/js/ui.js");

const fakeButton = () => ({ disabled: false });
const recorder = () => {
  const seen = { hold: null, said: null };
  return {
    seen,
    hold: (v) => { seen.hold = v; },
    said: (s) => { seen.said = s; },
  };
};

test("work that finishes leaves the guard released and the button armed, and says nothing", async () => {
  const btn = fakeButton();
  const r = recorder();
  await guarded({
    btn, hold: r.hold, work: async () => {}, said: r.said, trouble: "The price could not be asked for",
  });
  assert.equal(r.seen.hold, false, "the guard is released");
  assert.equal(btn.disabled, false, "and the button takes a press again");
  assert.equal(r.seen.said, null, "nothing is said, because nothing went wrong");
});

test("work that THROWS still releases the guard, arms the button, and SAYS so", async () => {
  const btn = fakeButton();
  const r = recorder();
  await guarded({
    btn,
    hold: r.hold,
    work: async () => { throw new Error("boom"); },
    said: r.said,
    trouble: "The price could not be asked for",
  });
  assert.equal(r.seen.hold, false, "the guard is released even though the work threw — the whole point");
  assert.equal(btn.disabled, false, "and the button is armed, so the next press is not swallowed");
  assert.equal(r.seen.said, "The price could not be asked for — boom.", "the throw is said, not swallowed");
});

test("the guard is held for the whole of the work, so a second press cannot slip in", async () => {
  const btn = fakeButton();
  const r = recorder();
  let during = null;
  await guarded({
    btn,
    hold: r.hold,
    work: async () => { during = { hold: r.seen.hold, disabled: btn.disabled }; },
    said: r.said,
    trouble: "T",
  });
  assert.deepEqual(during, { hold: true, disabled: true },
    "held and disabled while the work runs — one press at a time is the money rule");
});

test("a press with no button of its own — a dialog's own yes — is guarded all the same", async () => {
  const r = recorder();
  await guarded({
    hold: r.hold, work: async () => { throw new Error("boom"); }, said: r.said, trouble: "The booking could not be finished",
  });
  assert.equal(r.seen.hold, false, "the guard is released; there is simply no button to touch");
  assert.equal(r.seen.said, "The booking could not be finished — boom.");
});

test("a throw that is not an Error is still told as a sentence, and never as [object Object]", () => {
  assert.equal(saidOf(new Error("Failed to fetch")), "Failed to fetch.");
  assert.equal(saidOf(new Error("Failed to fetch.")), "Failed to fetch.", "one full stop, not two");
  assert.equal(saidOf(new Error("401 ")), "401.", "and no trailing space left behind");
  assert.equal(saidOf("Bad thing"), "Bad thing.", "a bare string is taken at its word");
  assert.equal(saidOf("Bad thing."), "Bad thing.");
});

test("a thrown value with nothing to say gets the honest sentence rather than a word off the plumbing", () => {
  const unknown = "the app could not say what went wrong.";
  assert.equal(saidOf(new Error("")), unknown, "an empty message");
  assert.equal(saidOf(new Error("   ")), unknown, "a message that is only spaces");
  assert.equal(saidOf(null), unknown);
  assert.equal(saidOf(undefined), unknown, "and the bare word used to be a whole screen's news");
  assert.equal(saidOf({ nope: 1 }), unknown,
    "an object is refused a voice: String() on one prints [object Object], which is v195's fault again");
  assert.equal(saidOf(Object.create(null)), unknown);
  assert.equal(saidOf(42), unknown, "a number is not a sentence either");
});
