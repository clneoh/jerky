// test/sw-cache-revalidation.test.js — does the service worker really go to the
// network for the app's own code?
//
// admin/sw.js has always said "network first". It was not. It called a bare
// `fetch(req)`, and GitHub Pages serves every file with `cache-control:
// max-age=600` and no build number in any URL — so "the network" was routinely
// the phone's own HTTP cache, handing back a file from ten minutes ago. A fix
// could be pushed and simply not arrive, which is the loop this version exists
// to break.
//
// The fix is one option: same-origin code is fetched with `cache: "no-cache"`,
// which makes the browser revalidate before using its copy. This file runs the
// REAL sw.js in a sandbox with a stub `self` and watches what it asks for —
// because a rule this quiet, in a file with no other coverage, would otherwise
// be reverted by the next tidy-up without a single test going red.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const SW_SOURCE = readFileSync(join(here, "..", "admin", "sw.js"), "utf8");
const ORIGIN = "https://bakery.test";

// Load sw.js the way a browser would, with just enough of the worker global
// scope for it to register its handlers.
function loadWorker({ fetchImpl, cacheHit } = {}) {
  const handlers = {};
  const put = [];
  const cache = {
    add: async () => {},
    put: async (req, res) => { put.push({ url: req.url, res }); },
  };
  const ctx = {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type, fn) => { (handlers[type] ||= []).push(fn); },
      skipWaiting() {},
      clients: { claim: async () => {} },
    },
    caches: {
      open: async () => cache,
      // Either one response for everything, or a lookup by URL — the offline
      // cases need to tell "the page is cached" from "the script is not".
      match: async (key) => {
        const url = typeof key === "string" ? key : key && key.url;
        return typeof cacheHit === "function" ? cacheHit(String(url)) : cacheHit;
      },
      keys: async () => [],
      delete: async () => true,
    },
    fetch: fetchImpl,
    URL,
    Response,
    Promise,
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(SW_SOURCE, ctx);
  return { handlers, put };
}

// Drive the fetch handler the way the browser does, and hand back what it
// answered with (the network calls it made are recorded on the stub fetch).
async function handle({ handlers }, request) {
  const [fn] = handlers.fetch;
  let answered;
  fn({ request, respondWith: (p) => { answered = p; } });
  return { response: await answered };
}

function workerWith(fetchImpl, cacheHit) {
  return loadWorker({ fetchImpl, cacheHit });
}

function recordingFetch(body = "ok") {
  const calls = [];
  return {
    calls,
    fetchImpl: async (req, init) => {
      calls.push({ url: typeof req === "string" ? req : req.url, init });
      return new Response(body, { status: 200 });
    },
  };
}

function req(url, mode) {
  return { method: "GET", url, mode };
}

test("a script is revalidated, not taken from the ten-minute cache", async () => {
  const net = recordingFetch();
  const w = workerWith(net.fetchImpl);
  await handle(w, req(`${ORIGIN}/admin/js/views/orders.js`, "cors"));

  assert.equal(net.calls.length, 1);
  assert.equal(net.calls[0].init.cache, "no-cache");
});

test("a stylesheet and the page itself are revalidated too", async () => {
  for (const [path, mode] of [["/admin/css/app.css", "cors"], ["/admin/index.html", "navigate"], ["/admin/", "navigate"]]) {
    const net = recordingFetch();
    const w = workerWith(net.fetchImpl);
    await handle(w, req(ORIGIN + path, mode));
    assert.equal(net.calls.length, 1, `${path} should reach the network once`);
    assert.equal(net.calls[0].init.cache, "no-cache", `${path} should be revalidated`);
  }
});

test("an image or the manifest keeps the plain fetch", async () => {
  for (const path of ["/admin/img/logo.png", "/admin/manifest.webmanifest", "/admin/icon.svg"]) {
    const net = recordingFetch();
    const w = workerWith(net.fetchImpl);
    await handle(w, req(ORIGIN + path, "cors"));
    assert.equal(net.calls.length, 1);
    // Not code: a stale one is not a bug, and revalidating it would be a
    // request per asset for nothing.
    assert.equal(net.calls[0].init, undefined, `${path} should not be revalidated`);
  }
});

test("a browser that refuses the option keeps the worker, and its offline cache", async () => {
  // fetch() with an unsupported init throws SYNCHRONOUSLY. If that escaped the
  // handler, respondWith would never be called and this worker would stop
  // intercepting anything at all — losing the offline shell for a fix that was
  // only ever meant to add freshness. The fallback is the old plain request.
  const calls = [];
  // NOT async: a real fetch() converts its arguments synchronously and throws a
  // TypeError there and then. An async stub would reject instead, the worker's
  // catch would miss it, and this test would pass over a bug it exists to find.
  const picky = (req, init) => {
    if (init !== undefined) throw new TypeError("cache mode not supported");
    calls.push({ url: req.url, init });
    return Promise.resolve(new Response("ok", { status: 200 }));
  };
  const w = workerWith(picky);
  const { response } = await handle(w, req(`${ORIGIN}/admin/js/app.js`, "cors"));

  assert.equal(await response.text(), "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init, undefined);
});

test("another origin is left alone", async () => {
  const net = recordingFetch();
  const w = workerWith(net.fetchImpl);
  const [fn] = w.handlers.fetch;
  let answered = false;
  fn({ request: req("https://supabase.test/rest/v1/orders", "cors"), respondWith: () => { answered = true; } });
  assert.equal(answered, false);
  assert.equal(net.calls.length, 0);
});

test("a fresh response is kept for offline, exactly as before", async () => {
  const net = recordingFetch("body");
  const w = workerWith(net.fetchImpl);
  await handle(w, req(`${ORIGIN}/admin/js/app.js`, "cors"));
  assert.equal(w.put.length, 1);
  assert.match(w.put[0].url, /app\.js$/);
});

test("offline still falls back to the cache — and only a page may fall back to the shell", async () => {
  const dead = async () => { throw new Error("offline"); };
  const hit = new Response("cached", { status: 200 });

  const page = workerWith(dead, hit);
  const pageRes = await handle(page, req(`${ORIGIN}/admin/orders`, "navigate"));
  assert.equal(await pageRes.response.text(), "cached");

  // A page with nothing cached for it still opens, from the shell.
  const shell = new Response("<html>shell</html>", { status: 200 });
  const bare = workerWith(dead, (url) => (url.endsWith("index.html") ? shell : undefined));
  const bareRes = await handle(bare, req(`${ORIGIN}/admin/orders`, "navigate"));
  assert.equal(await bareRes.response.text(), "<html>shell</html>");

  // The trap the file's own comment warns about: answering a .js request with
  // the cached HTML makes the browser run a web page as JavaScript, which
  // silently kills that file and everything it wired up. With nothing cached
  // for it, a script must fail as itself.
  const script = workerWith(dead, (url) => (url.endsWith("index.html") ? shell : undefined));
  const scriptRes = await handle(script, req(`${ORIGIN}/admin/js/app.js`, "cors"));
  assert.equal(scriptRes.response.type, "error");
});
