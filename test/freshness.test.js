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

import { parseVersion, deployedBuild, decide, startFreshnessWatch } from "../admin/js/freshness.js";
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
