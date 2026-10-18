// test/weekday-names.test.js — a weekday NUMBER said back as a day (v548).
//
// ⚠️⚠️ THE FAULT: `Number(null)`, `Number("")` and `Number(false)` are all **0**, and 0 is SUNDAY. ⭐ So a
// blank entry in a saved bake-day pattern was printed as a day she never chose: an imported
// `deliveryDays: [1, null, 3]` made Home and the Bake days screen say **"Mon, Sun and Wed"**.
// ⚠️ **This is the same `Number(null) IS 0` that put SUNDAY on a receipt in v441** — the third time that
// one coercion has worn a new dress.

import { test } from "node:test";
import assert from "node:assert/strict";

import { dayName, dayListLabel } from "../admin/js/dates.js";
import { normalize } from "../admin/js/state.js";

test("★★★ a missing weekday is NOT Sunday", () => {
  for (const blank of [null, undefined, "", false]) {
    assert.equal(dayName(blank), "",
      `★ ${JSON.stringify(blank)} was named as a day — **a blank is not an answer to "which days do you `
      + "bake\", and printing it as Sunday invents one**");
  }
  assert.equal(dayName(0), "Sun", "precondition: 0 really is Sunday when it IS a number");
  assert.equal(dayName(7), "", "out of range is nothing, not the seventh day");
});

test("★★ a pattern with a blank in it names only the days she chose", () => {
  assert.equal(dayListLabel([1, null, 3]), "Mon and Wed",
    "★ a blank entry was printed as a day — **the app told her she bakes on a Sunday she never ticked**");
  assert.equal(dayListLabel([0]), "Sun", "precondition: a real Sunday still reads as Sunday");
  assert.equal(dayListLabel([1, 3, 5]), "Mon, Wed and Fri");
});

test("★★★ a saved bake-day pattern is cleaned when it is loaded", () => {
  const out = normalize({ version: 1, settings: { deliveryDays: [1, null, 3, 9, "x", 1] } });
  assert.deepEqual(out.settings.deliveryDays, [1, 3],
    "★ a saved pattern kept a blank or an impossible day — **every screen that names the pattern reads it**");
});

test("★★ and an emptied pattern falls back to the default rather than to no days at all", () => {
  const out = normalize({ version: 1, settings: { deliveryDays: [] } });
  assert.deepEqual(out.settings.deliveryDays, [1, 3, 5],
    "★ an emptied pattern left the app with no bake days — a blank is not an answer here either");
});
