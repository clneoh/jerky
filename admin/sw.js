// sw.js — offline app shell for the backoffice.
// Network-first with cache fallback: fresh updates when online, offline works
// once the app has been visited. Same-origin GET only — Supabase REST calls
// are cross-origin and pass through untouched.

const CACHE = "bakeadmin-admin-v1";
const SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./css/print.css",
  "./manifest.webmanifest",
];

// The app's own code: the page, its scripts and its stylesheets. GitHub Pages
// hands every one of them `cache-control: max-age=600` and no URL in the app
// carries a build number, so a plain fetch can be answered out of the phone's
// own ten-minute cache — a fix pushed a minute ago, and the phone still running
// yesterday's file with nothing on screen to say so.
//
// `cache: "no-cache"` does not skip the cache; it makes the browser revalidate
// before using it. An unchanged file costs one tiny 304; a changed one is
// fetched whole. Images and the manifest keep the plain behaviour — they are
// not code, and a stale one is not a bug.
const CODE = /\.(?:js|css|html)$/i;
function isCode(req) {
  if (req.mode === "navigate") return true;
  try { return CODE.test(new URL(req.url).pathname); } catch { return false; }
}

// The one place the option is used. A browser that refused it would throw
// SYNCHRONOUSLY here — before respondWith is ever called — and this worker would
// stop intercepting anything, taking the offline cache down with it. So the
// fallback is the plain request it would have made before this version: at worst
// the old behaviour, never a broken app.
function askNetwork(req) {
  if (!isCode(req)) return fetch(req);
  try {
    return fetch(req, { cache: "no-cache" });
  } catch {
    return fetch(req);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(SHELL.map((u) => cache.add(u).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;
  const fromNetwork = askNetwork(req);
  event.respondWith(
    fromNetwork
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => {
          if (hit) return hit;
          // Only a page navigation may fall back to the cached shell. Anything
          // else — a script, a stylesheet, an image — has to fail as itself:
          // answering a .js request with HTML makes the browser run a web page
          // as JavaScript, which silently kills that file and everything it was
          // supposed to wire up.
          return req.mode === "navigate"
            ? caches.match("./index.html")
            : Response.error();
        })
      )
  );
});
