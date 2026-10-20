// test/v608-repairs.test.js — a private sale's day is not announced anywhere.
//
// ⚠️ SOURCE CHECKS, NAMED AS SUCH. The behaviour is DRIVEN in state.test.js (`bakeDays`), order-stage
// (the day card says nothing special) and supabase.test.js (publishing skips it). What is here is the
// REACH of the filter: every surface that lists days must ask the same question.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("★★★ every bake-day surface filters the private sale day (v608)", () => {
  assert.match(read("admin/js/views/orders.js"),
    /function deliveryDayList\(state\) \{[\s\S]{0,300}\[...bakeDays\(state\)\]/,
    "★ the Orders calendar offers a private sale day as a day to pick");
  assert.match(read("admin/js/views/deliveries.js"), /\[\.\.\.bakeDays\(state\)\]/,
    "★ the Bake days screen lists a private sale day as a bake day");
  assert.match(read("admin/js/views/dashboard.js"), /bakeDays\(state\)/,
    "★ Home's upcoming deliveries list a private sale day");
  assert.match(read("admin/js/views/po.js"), /bakeDays\(state\)/,
    "★ the purchase order offers a private sale day as a shopping day");
  assert.match(read("admin/js/supabase.js"), /if \(d\.recordOnly\) continue;/,
    "★ the shop is offered a private sale day");
});

test("★★ the private day says nothing about itself (v608)", () => {
  const orders = read("admin/js/views/orders.js");
  // ⚠️ Match the CODE, not the comment that explains the removal — a guard must not trip on its own
  // explanation.
  assert.match(orders, /date\.recordOnly \? ""/,
    "★ the private day's card no longer says nothing — it announces itself again");
});

test("★★ a bake recorded on a private day is still told it changes nothing official (v609)", () => {
  assert.match(read("admin/js/views/orders.js"),
    /const isBakeDay = bakeDays\(state\)\.some/,
    "★ the baked box treats a private sale day as an official bake day");
});
