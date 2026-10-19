// test/units.test.js — what a unit's factor is allowed to be (v583).
//
// ⚠️⚠️ TWO FAULTS, MEASURED IN THE AUDIT: a Count unit's factor was forced to 1 **while the box showed what
// she typed** (12 for "dozen", saved as 1 — a number on screen that was never used), and a CLEARED or zero
// factor became **0.0001** in silence — ⚠️ **a unit that then rescaled every stock figure and recipe cost
// using it.** ⭐ The rule is one function, tested here rather than through a screen.

import { test } from "node:test";
import assert from "node:assert/strict";

const { unitFactor } = await import("../admin/js/views/units.js");

test("★★★ a count unit is pieces — 1:1, whatever is typed", () => {
  assert.deepEqual(unitFactor("count", "12", "dozen"), { toBase: 1 });
  assert.deepEqual(unitFactor("count", "", "pcs"), { toBase: 1 });
});

test("★★★ a missing, zero or negative factor is REFUSED, not turned into 0.0001", () => {
  for (const raw of ["", "   ", "0", "-5", "nonsense"]) {
    const f = unitFactor("weight", raw, "kg");
    assert.ok(f.error, `★ "${raw}" was accepted as a factor`);
    assert.match(f.error, /cannot be zero/);
  }
  assert.deepEqual(unitFactor("weight", "1000", "kg"), { toBase: 1000 });
  assert.deepEqual(unitFactor("volume", "1000", "L"), { toBase: 1000 });
});
