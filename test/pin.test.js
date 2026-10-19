// test/pin.test.js — the device-local app-password helpers (pure, no DOM).

import { test } from "node:test";
import assert from "node:assert/strict";
import { isPin, hashPin, hasStoredPin, lockEnabled } from "../admin/js/pin.js";

const HASH_1234 = "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4";

test("isPin accepts exactly 4 digits as a string", () => {
  assert.equal(isPin("1234"), true);
  assert.equal(isPin("0000"), true);
  assert.equal(isPin("9999"), true);
});

test("isPin rejects anything that isn't 4 digits", () => {
  for (const bad of ["123", "12345", "12a4", " 123", "1234 ", "", null, undefined, 1234, "12.4"]) {
    assert.equal(isPin(bad), false, `isPin(${JSON.stringify(bad)}) should be false`);
  }
});

test("hashPin is the SHA-256 hex digest (deterministic)", async () => {
  assert.equal(await hashPin("1234"), HASH_1234);
  assert.equal(await hashPin("0000").then((h) => /^[0-9a-f]{64}$/.test(h)), true, "64 lowercase hex");
  assert.notEqual(await hashPin("0000"), HASH_1234, "different PINs hash differently");
});

test("hasStoredPin needs a well-formed 64-hex pinHash", () => {
  assert.equal(hasStoredPin({}), false);
  assert.equal(hasStoredPin({ lock: {} }), false);
  assert.equal(hasStoredPin({ lock: { pinHash: "" } }), false);
  assert.equal(hasStoredPin({ lock: { pinHash: "zz" } }), false, "not hex");
  assert.equal(hasStoredPin({ lock: { pinHash: "abc" } }), false, "not 64 chars");
  assert.equal(hasStoredPin({ lock: { pinHash: HASH_1234 } }), true);
});

test("lockEnabled requires both the toggle AND a stored hash", () => {
  assert.equal(lockEnabled({}), false, "no lock config");
  assert.equal(lockEnabled({ lock: {} }), false);
  assert.equal(lockEnabled({ lock: { enabled: true, pinHash: "" } }), false, "enabled but no PIN → never locks out");
  assert.equal(lockEnabled({ lock: { enabled: false, pinHash: HASH_1234 } }), false, "PIN set but toggled off");
  assert.equal(lockEnabled({ lock: { enabled: true, pinHash: HASH_1234 } }), true);
  assert.equal(lockEnabled(null), false);
});

test("★★★ a wrong password costs a wait after three tries — and never traps her", async () => {
  // ⚠️⚠️ There was no pause at all: four digits, tried as fast as a thumb can tap, on an app that ships
  // with a published default. ⭐ Three are free (a thumb mistypes); after that the wait doubles, capped.
  const { wrongPauseMs } = await import("../admin/js/views/lock.js");
  assert.equal(wrongPauseMs(0), 0);
  assert.equal(wrongPauseMs(1), 0, "the first try is free");
  assert.equal(wrongPauseMs(2), 0, "and so are two more — a thumb on a phone mistypes");
  assert.equal(wrongPauseMs(3), 1000, "★ the third wrong try cost nothing — **a four-digit code can be tried at thumb speed**");
  assert.equal(wrongPauseMs(4), 2000);
  assert.equal(wrongPauseMs(5), 4000);
  assert.equal(wrongPauseMs(20), 30000, "and it never grows past half a minute — a lockout is not the job");
});
