// test/service-worker.test.js — a failed request must never be answered with
// the app shell.
//
// The backoffice's worker is network-first with a cache fallback. The original
// fallback was `caches.match(req).then((hit) => hit || caches.match("./index.html"))`,
// which hands ./index.html — a web page — to ANY request that failed, including
// a .js request. The browser then runs a page as JavaScript, the module never
// executes, and whatever it was meant to wire up is silently dead.
//
// These tests run the real worker script in a stand-in worker scope and drive
// its fetch handler, so the response to a failure is asserted as a response —
// not as a string in the source.
//
// Not tested here: the bakery also added a one-time cleanup worker at the SITE
// ROOT (`sw.js`) for phones still carrying the bakery's old root-scoped worker.
// jerky never served the app from the site root, never registered a root worker
// and is a different origin anyway, so it needs no such file — the homepage's
// EN / 中文 / BM buttons cannot be broken that way.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ORIGIN = "https://munchies.com.my";
const SHELL = "<!doctype html><title>Backoffice</title>";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// A stand-in service-worker global scope. Returns the listeners the script
// registered.
function loadWorker(path, opts = {}) {
  const listeners = {};

  const sandbox = {
    caches: {
      keys: async () => [],
      delete: async () => true,
      open: async () => ({ add: async () => {}, put: async () => {} }),
      match: async (key) => (opts.match ? opts.match(key) : null),
    },
    fetch: opts.fetch || (async () => new Response("fresh", { status: 200 })),
    Response,
    Promise,
    console,
    self: {
      location: { origin: ORIGIN, href: `${ORIGIN}/${path}` },
      addEventListener: (type, fn) => {
        (listeners[type] ||= []).push(fn);
      },
      skipWaiting: () => {},
      clients: { claim: async () => {} },
    },
  };

  vm.runInNewContext(read(path), sandbox, { filename: path });
  return { listeners };
}

// Plain objects, not Request: `mode: "navigate"` cannot be set through the
// Request constructor, and these are the only three fields the worker reads.
const req = (url, mode = "no-cors") => ({ method: "GET", url, mode });

function respond(handler, request) {
  let out;
  handler({ request, respondWith: (p) => { out = p; } });
  return out;
}

const offline = async () => {
  throw new Error("offline");
};

test("a failed script request is never answered with a web page", async () => {
  const w = loadWorker("admin/sw.js", {
    fetch: offline,
    match: async (key) => (key === "./index.html" ? new Response(SHELL) : null),
  });
  const res = await respond(w.listeners.fetch[0], req(`${ORIGIN}/admin/js/app.js`));

  assert.equal(res.type, "error", "a script must fail as a script, not receive HTML");
  assert.equal(res.status, 0);
  assert.notEqual(await res.text().catch(() => SHELL), SHELL);
});

test("a stylesheet or image failure is not answered with a web page either", async () => {
  for (const url of [`${ORIGIN}/admin/css/app.css`, `${ORIGIN}/admin/icon-192.png`]) {
    const w = loadWorker("admin/sw.js", {
      fetch: offline,
      match: async (key) => (key === "./index.html" ? new Response(SHELL) : null),
    });
    const res = await respond(w.listeners.fetch[0], req(url));
    assert.equal(res.type, "error", `${url} must not receive HTML`);
  }
});

test("a page navigation still falls back to the cached shell offline", async () => {
  const w = loadWorker("admin/sw.js", {
    fetch: offline,
    match: async (key) => (key === "./index.html" ? new Response(SHELL) : null),
  });
  const res = await respond(
    w.listeners.fetch[0],
    req(`${ORIGIN}/admin/index.html`, "navigate")
  );

  assert.equal(res.status, 200);
  assert.equal(await res.text(), SHELL);
});

test("a cached copy is still served when the network is down", async () => {
  const cached = new Response("/* cached */");
  const w = loadWorker("admin/sw.js", {
    fetch: offline,
    match: async (key) => {
      const url = typeof key === "string" ? key : key.url;
      return url.endsWith("app.js") ? cached : null;
    },
  });
  const res = await respond(w.listeners.fetch[0], req(`${ORIGIN}/admin/js/app.js`));

  assert.equal(await res.text(), "/* cached */", "offline support must survive the fix");
});
