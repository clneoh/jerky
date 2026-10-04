// test/time_window.test.js - how a time window is read, packed, checked and said (v191, and its
// own module from v304).
//
// THE WINDOW IS A PROMISE. It is published to customers through a day's own words and, since
// v304, through a Self collection Point's own collection hours as well - so a window that reads
// wrongly ("11-2 pm" for eleven in the morning) or one that ends before it starts must not be
// able to become published words anywhere.
//
// Moved out of courier-run.test.js when the window stopped being the courier's alone and became
// a leaf module both the courier and the Points card read (v304). Pure - no DOM, no fetch.

import { test } from "node:test";
import assert from "node:assert/strict";

const { windowAt, windowParts, validWindow, windowProblem, fmtWindow, clockOf } =
  await import("../admin/js/time_window.js");

// ── the window ───────────────────────────────────────────────────

test("the two boxes pack into one value and come apart again", () => {
  assert.equal(windowAt("14:00", "17:00"), "14:00-17:00");
  assert.equal(windowAt("9:30", "11:00"), "09:30-11:00", "a single-digit hour is zero-padded in what is stored");
  assert.equal(windowAt("", "17:00"), "", "half a window is not a window");
  assert.equal(windowAt("14:00", ""), "");
  assert.equal(windowAt("25:00", "17:00"), "");
  assert.equal(windowAt("14:70", "17:00"), "");
  assert.equal(windowAt("2pm", "5pm"), "", "the app's own time boxes speak 24-hour, and a stray free-text hour is refused");

  assert.deepEqual(windowParts("14:00-17:00"), { from: "14:00", to: "17:00" });
  assert.deepEqual(windowParts("09:30-11:00"), { from: "09:30", to: "11:00" });
  assert.equal(windowParts(""), null);
  assert.equal(windowParts("2-5 pm"), null, "the words it PRINTS are not the value it stores");
  assert.equal(windowParts("14:00-"), null);
});

test("a window is only a window when it ends after it starts", () => {
  assert.equal(validWindow("14:00-17:00"), true);
  assert.equal(validWindow("14:00-14:30"), true);
  assert.equal(validWindow("17:00-14:00"), false, "an end before its start is not an earlier delivery, it is a mistake");
  assert.equal(validWindow("14:00-14:00"), false, "a zero-length window promises a van at one instant");
  assert.equal(validWindow(""), false, "no window is not a valid window — it is the day's promise, and the caller says which it holds");
  assert.equal(validWindow("nonsense"), false);
});

test("an empty window is not a problem, and a half-filled one is", () => {
  // "No window" is the promise the shop already makes — a day — so asking for a window
  // and getting nothing is not an error. This is the difference between a form that
  // helps and one that nags.
  assert.equal(windowProblem("", ""), "");
  assert.equal(windowProblem("14:00", "17:00"), "");
  assert.notEqual(windowProblem("14:00", ""), "", "one end filled is a promise with a hole in it");
  assert.notEqual(windowProblem("", "17:00"), "", "and so is the other end alone");
  assert.notEqual(windowProblem("2pm", "5pm"), "", "unreadable times are said, not silently dropped");
  assert.notEqual(windowProblem("17:00", "14:00"), "", "an end before its start is refused in words");
  assert.notEqual(windowProblem("14:00", "14:00"), "");
});

test("the window reads the way she would say it", () => {
  assert.equal(fmtWindow("14:00-17:00"), "2-5 pm");
  assert.equal(fmtWindow("09:00-11:00"), "9-11 am");
  // The repeated meridiem is dropped only when both ends share it. "11-2 pm" would read
  // as eleven at night, and a delivery promise is not the place to be terse.
  assert.equal(fmtWindow("11:00-14:00"), "11 am-2 pm");
  assert.equal(fmtWindow("12:00-15:00"), "12-3 pm", "noon is 12 pm, not 0 pm");
  assert.equal(fmtWindow("00:00-01:00"), "12-1 am", "and midnight is 12 am");
  assert.equal(fmtWindow("11:30-14:00"), "11:30 am-2 pm", "a half hour is kept only where it exists");
  assert.equal(fmtWindow("14:30-17:00"), "2:30-5 pm");
  assert.equal(fmtWindow(""), "");
  assert.equal(fmtWindow("rubbish"), "");
});

