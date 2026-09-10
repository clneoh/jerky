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
  event.respondWith(
    fetch(req)
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
