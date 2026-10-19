// test/production-fields.test.js — what a number in the production plan may be (v583).
//
// ⚠️⚠️ MEASURED: typing 0 in a minutes field was quietly refused, while the plan's own clamp accepts 0 for
// every time — ⚠️ **"the latest moment a stage may start" with no early tolerance, no cooling wait, or a day
// that starts at midnight are all real answers**, and the box threw them away. ⭐ A COUNT still needs one.

import { test } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem(k) { return store.has(k) ? store.get(k) : null; },
  setItem(k, v) { store.set(k, String(v)); },
  removeItem(k) { store.delete(k); },
};

const { writeField } = await import("../admin/js/views/production.js");

test("★★★ a TIME may be zero; a count may not (v583)", () => {
  const st = { settings: {} };
  const plan = {};
  for (const k of ["tolMin", "coolWaitMin", "readyAtMin", "foldMin", "foldRests", "rhythmMin"]) {
    writeField(plan, st, k, "0");
    assert.equal(plan[k], 0, `★ 0 was refused for ${k} — a real answer the plan already accepts`);
  }
  for (const k of ["pans", "prooferPans", "hours"]) {
    writeField(plan, st, k, "0");
    assert.equal(plan[k], undefined, `★ 0 was written for ${k} — a count of nothing`);
  }
  // A negative and a cleared box are still nothing to write.
  writeField(plan, st, "tolMin", "-5");
  assert.equal(plan.tolMin, 0, "a negative was written over a real answer");
  writeField(plan, st, "tolMin", "");
  assert.equal(plan.tolMin, 0, "a cleared box wrote a zero");
});
