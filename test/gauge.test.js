// test/gauge.test.js — the fuel-gauge needle dial math (pure part of gauge.js).

import { test } from "node:test";
import assert from "node:assert/strict";

const { gaugeState } = await import("../admin/js/gauge.js");

test("gaugeState: empty day stays at 0 with no orders", () => {
  assert.deepEqual(gaugeState(0, 12), { pct: 0, status: "empty" });
});

test("gaugeState: partial orders point partway, still open", () => {
  assert.deepEqual(gaugeState(6, 12), { pct: 0.5, status: "open" });
});

test("gaugeState: exactly at capacity is full (pct capped at 1)", () => {
  assert.deepEqual(gaugeState(12, 12), { pct: 1, status: "open" });
});

test("gaugeState: over capacity reads red and stays pegged", () => {
  assert.deepEqual(gaugeState(15, 12), { pct: 1, status: "over" });
  assert.deepEqual(gaugeState(99, 12), { pct: 1, status: "over" }, "ratio clamped");
});

test("gaugeState: no capacity still handles orders and zero sanely", () => {
  assert.deepEqual(gaugeState(0, 0), { pct: 0, status: "empty" });
  assert.deepEqual(gaugeState(4, 0), { pct: 0, status: "over" });
  assert.deepEqual(gaugeState(3, undefined), { pct: 0, status: "over" });
});
