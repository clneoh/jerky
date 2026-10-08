// test/freshness.test.js — can a phone tell that it is running an old build?
//
// GitHub Pages serves the backoffice with `cache-control: max-age=600` and no
// build number in any URL, so a fix can be pushed and not arrive. That has cost
// several rounds of "still the same problem". admin/js/freshness.js asks the
// site which build it is serving right now and says so when this phone is
// behind — and the whole value of it rests on two things this file pins:
//
//   1. the probe is NEVER answered from a cache (a cached answer is the very
//      thing being checked for), and
//   2. the version pattern still matches the real admin/js/version.js, because
//      a reformat that stops it matching would kill the strip silently.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseVersion, deployedBuild, decide, shouldReload, maybeReloadForUpdate, startFreshnessWatch } from "../admin/js/freshness.js";
import { ENGINE_VERSION } from "../admin/js/version.js";

const here = dirname(fileURLToPath(import.meta.url));
const VERSION_FILE = join(here, "..", "admin", "js", "version.js");
const BASE = "https://bakery.test/admin/";

// A fetch that answers the version probe and records how it was called.
function answering(body, { ok = true, throws = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (throws) throw new Error("offline");
    return { ok, text: async () => body };
  };
  return { fetchImpl, calls };
}

test("the version pattern still matches the file the app actually ships", () => {
  const onDisk = readFileSync(VERSION_FILE, "utf8");
  assert.equal(parseVersion(onDisk), ENGINE_VERSION);
});

test("parseVersion reads a version out of a copy of version.js", () => {
  assert.equal(parseVersion('export const ENGINE_VERSION = "258";'), "258");
  assert.equal(parseVersion("export const ENGINE_VERSION='99';"), "99");
  assert.equal(parseVersion("nothing here"), null);
  assert.equal(parseVersion(""), null);
  assert.equal(parseVersion(null), null);
  assert.equal(parseVersion(undefined), null);
});

test("the probe is asked for with no cache, and with a cache-busting query", async () => {
  const { fetchImpl, calls } = answering('export const ENGINE_VERSION = "258";');
  const got = await deployedBuild({ fetchImpl, base: BASE });

  assert.equal(got, "258");
  assert.equal(calls.length, 1);
  // The load-bearing half: a plain fetch here could be answered out of the
  // phone's own ten-minute cache and report the phone's OWN build back as if it
  // were the site's — the check would then always say "up to date".
  assert.equal(calls[0].init.cache, "no-store");
  assert.match(calls[0].url, /\/admin\/js\/version\.js\?probe=\d+$/);
});

test("no answer means no claim", async () => {
  const bad = answering("", { ok: false });
  assert.equal(await deployedBuild({ fetchImpl: bad.fetchImpl, base: BASE }), null);

  const offline = answering("", { throws: true });
  assert.equal(await deployedBuild({ fetchImpl: offline.fetchImpl, base: BASE }), null);

  const junk = answering("<html>not a module</html>");
  assert.equal(await deployedBuild({ fetchImpl: junk.fetchImpl, base: BASE }), null);

  // A probe with nowhere to point must not throw either.
  assert.equal(await deployedBuild({ fetchImpl: bad.fetchImpl, base: "" }), null);
});

test("decide: nothing to say when the phone is current, or ahead of the site", () => {
  assert.equal(decide({ running: "258", deployed: "258" }), null);
  assert.equal(decide({ running: "258", deployed: null }), null); // offline / unreadable
  assert.equal(decide({ running: "258", deployed: "257" }), null); // a rollback is not her problem
  assert.equal(decide({ running: "258" }), null);
  assert.equal(decide({}), null);
});

test("decide: behind offers the update, and names both builds", () => {
  const info = decide({ running: "257", deployed: "258" });
  assert.equal(info.tone, "update");
  assert.equal(info.label, "Update now");
  assert.match(info.text, /v257/);
  assert.match(info.text, /v258/);
});

test("decide: behind AFTER a reload stops offering it and names the next step", () => {
  // A reload inside the ten-minute window can still be served from the cache.
  // Offering the same tap again would be a control that does nothing.
  const info = decide({ running: "257", deployed: "258", tried: true });
  assert.equal(info.tone, "wait");
  assert.equal(info.label, undefined);
  assert.match(info.text, /Close the app completely/);
  assert.match(info.text, /v257/);
  assert.match(info.text, /v258/);
});

test("the watch is inert where there is no page to draw it on", () => {
  // Every view module in this suite is imported by tests whose document is a
  // shim, or absent entirely. Neither may throw, and the returned stop function
  // must be safe to call.
  const stop = startFreshnessWatch({ running: ENGINE_VERSION });
  assert.equal(typeof stop, "function");
  assert.doesNotThrow(() => stop());
});

// ── ★★ the phone re-loads itself into the new build BEFORE the lock (v383) ────
// Her report: __"some app user after keying in pin, but login to an old version app"__. The warning
// that should have told them was being painted UNDER the lock screen (strip layer 25, lock layer 80),
// so the reload now happens first and the lock is never reached in an old build.

test("shouldReload: nothing to do when the phone is current, or ahead of the site", () => {
  assert.equal(shouldReload({ running: "300", deployed: "300" }), false, "same build");
  assert.equal(shouldReload({ running: "300", deployed: null }), false, "no answer — offline, or a bad body");
  assert.equal(shouldReload({ running: "300", deployed: "" }), false);
  assert.equal(shouldReload({ running: "300" }), false);
  assert.equal(shouldReload({}), false);
  assert.equal(shouldReload({ running: "301", deployed: "300" }), false, "this phone is AHEAD — not a problem to act on");
});

test("★★ shouldReload: behind reloads once, and only once", () => {
  assert.equal(shouldReload({ running: "300", deployed: "382" }), true, "behind, never tried → reload");
  assert.equal(shouldReload({ running: "300", deployed: "382", tried: false }), true);
  // ⚠️⚠️ THE ANTI-LOOP RULE, and the reason this feature is not merely nice to have. A phone that
  // reloads into the SAME stale build — a wedged deploy, a proxy serving an old file, a cache that
  // will not let go — would reload for ever and its owner would never reach a lock screen again.
  // One attempt per build, then it gives up and the strip explains why.
  assert.equal(shouldReload({ running: "300", deployed: "382", tried: true }), false,
    "a second reload for the same build would loop for ever");
});

test("★★⚠️ the reload fires ONCE, records the build it tried, and does not fire again", async () => {
  const store = new Map();
  const realSession = globalThis.sessionStorage;
  const realLocation = globalThis.location;
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  let reloads = 0;
  globalThis.location = { href: BASE, reload: () => { reloads += 1; } };
  const { fetchImpl } = answering("export const ENGINE_VERSION = \"382\";");
  try {
    assert.equal(await maybeReloadForUpdate({ running: "300", fetchImpl }), true, "a behind phone must reload");
    assert.equal(reloads, 1, "it did not actually ask the page to reload");
    assert.equal(store.get("bakeadmin.updateTried"), "382",
      "⚠️ the build it tried is not recorded, so the next boot would reload again — for ever");

    // The boot the reload causes: same build on the site, and the attempt already recorded.
    assert.equal(await maybeReloadForUpdate({ running: "300", fetchImpl }), false,
      "⚠️ it reloaded a SECOND time — a phone stuck behind would never reach a lock screen");
    assert.equal(reloads, 1, "a second reload was asked for after the first");
  } finally {
    globalThis.sessionStorage = realSession;
    globalThis.location = realLocation;
  }
});

test("⚠️ a phone that is already current never reloads — the boot is not disturbed", async () => {
  const realLocation = globalThis.location;
  let reloads = 0;
  globalThis.location = { href: BASE, reload: () => { reloads += 1; } };
  const { fetchImpl } = answering("export const ENGINE_VERSION = \"382\";");
  try {
    assert.equal(await maybeReloadForUpdate({ running: "382", fetchImpl }), false);
    assert.equal(reloads, 0, "a current phone reloaded for nothing — every open would flash the page");
  } finally { globalThis.location = realLocation; }
});

test("⚠️⚠️ a probe that HANGS does not hold the app up — it is deadlined", async () => {
  // ⚠️ THE RISK THIS FEATURE INTRODUCES, AND WHY IT IS DEADLINED. The check now runs on the boot
  // path, BEFORE the lock — so a fetch that never settles would leave a phone with no lock screen,
  // no app, and nothing to press. That is a WORSE fault than the one being fixed. A promise that
  // never resolves must therefore come back as "no answer" rather than as a wait.
  const started = Date.now();
  const hung = await deployedBuild({
    base: BASE,
    timeoutMs: 60,
    fetchImpl: () => new Promise(() => {}), // never settles, never throws
  });
  assert.equal(hung, null, "a hung probe must answer 'nothing learned', not hang the boot");
  assert.ok(Date.now() - started < 2000, `the deadline did not fire — waited ${Date.now() - started}ms`);
});

// ── ★★⚠️ the warning is READABLE AT THE LOCK, not painted under it (v383) ─────
// ⚠️⚠️ THIS IS THE BUG ITSELF, PINNED BY A RULE RATHER THAN BY A NUMBER. The strip sat at layer 25
// while the lock screen is a full-screen OPAQUE panel at layer 80 — so the one message saying "this
// phone is behind" was drawn UNDERNEATH the screen the person was looking at. Proved on a real
// screen: a tap at the centre of the warning reached the Unlock button.
//
// ⚠️ A LAYER NUMBER IS EXACTLY THE KIND OF THING A LATER EDIT MOVES WITHOUT KNOWING: 25 looks
// harmless on its own, and nothing about it says what it is standing behind. This compares the two
// rules, so the strip can never quietly sink beneath the gate again — and it fails with the reason.
test("★★⚠️ the update strip sits ABOVE the lock screen, or the warning is invisible", () => {
  const css = readFileSync(join(here, "..", "admin", "css", "app.css"), "utf8");
  const layerOf = (sel) => {
    const rule = new RegExp(`\\${sel}\\s*\\{[^}]*\\}`, "m").exec(css);
    assert.ok(rule, `${sel} has no rule in app.css — has it been renamed?`);
    const z = /z-index:\s*(-?\d+)/.exec(rule[0]);
    assert.ok(z, `${sel} declares no z-index, so its layer is whatever it happens to inherit`);
    return Number(z[1]);
  };
  const bar = layerOf(".update-bar");
  const lock = layerOf(".lock-layer");
  assert.ok(bar > lock,
    `the update strip (z-index ${bar}) is BELOW the lock screen (z-index ${lock}) — the warning that `
    + "says this phone is behind would be painted under the screen the person is looking at");
});
