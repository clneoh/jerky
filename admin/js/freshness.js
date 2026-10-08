// freshness.js — "is this phone still running yesterday's build?"
//
// The backoffice is served by GitHub Pages, which hands every file a ten-minute
// cache and puts no build number in any URL. So a fix pushed a minute ago can
// still be answered out of the phone's own cache: the old code runs, and
// nothing on screen says so. A fault that was fixed then gets reported again —
// which is exactly what has happened here.
//
// The app cannot change those headers, so it does the next best thing: ask the
// site which build it is serving RIGHT NOW, and say so when this phone is
// behind. Being able to see a stale build is what turns "still broken?" from a
// guess into a fact.
//
// The decision is a pure function (decide) so it can be tested with no DOM, and
// the module is inert when fetch or document is missing.

import { el, button } from "./ui.js";

const VERSION_RE = /ENGINE_VERSION\s*=\s*["']([^"']+)["']/;
const TRIED_KEY = "bakeadmin.updateTried";

// ⚠️⚠️ A PROBE THAT NEVER ANSWERS MUST NEVER HOLD UP THE APP (v383). The version check now runs on the
// boot path, BEFORE the lock screen — so a fetch that hangs would leave a phone with no lock, no app
// and nothing to press. ⚠️ That is a worse fault than the one this fixes. The check is a courtesy; the
// app is not, so it gets a deadline and the app carries on without an answer when it passes.
// (The watch alone could afford to hang, because it is fire-and-forget. This cannot.)
const PROBE_MS = 2500;

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let done = false;
    const settle = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => settle(null), ms);
    Promise.resolve(promise).then(settle, () => settle(null));
  });
}

// The one-shot record of "this phone has already tried a reload for that build". Module scope so the
// pre-lock reload and the watch below agree on it — one fact, one key, one meaning.
const readTried = () => {
  try { return sessionStorage.getItem(TRIED_KEY) || null; } catch { return null; }
};
const noteTried = (v) => {
  try { sessionStorage.setItem(TRIED_KEY, v); } catch { /* private mode; the reload still works */ }
};

// The build named inside a copy of version.js. Exported so the test can read
// the real file the app ships and prove this pattern still matches it.
export function parseVersion(text) {
  const m = VERSION_RE.exec(String(text == null ? "" : text));
  return m ? m[1] : null;
}

function num(v) {
  return /^\d+$/.test(String(v)) ? Number(v) : null;
}

// The build the site is serving, or null when that cannot be learned — offline,
// no fetch, an error, or an answer with no version in it. `cache: "no-store"`
// is the whole point of the request: it must never be answered from a cache,
// because a cached answer is the very thing being checked for. The query is a
// second belt on the same braces, for a proxy that ignores the header.
export async function deployedBuild({ fetchImpl, base, timeoutMs = PROBE_MS } = {}) {
  const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
  const href = base || (typeof location !== "undefined" && location.href ? location.href : "");
  if (!f || !href) return null;
  try {
    const url = new URL("js/version.js", href);
    url.searchParams.set("probe", String(Date.now()));
    // ⚠️ DEADLINED, not merely try/caught: a fetch that never settles neither resolves nor throws, so
    // the catch below would never run and the boot would wait for ever.
    const res = await withTimeout(f(url.href, { cache: "no-store" }), timeoutMs);
    if (!res || !res.ok) return null;
    return parseVersion(await res.text());
  } catch {
    return null;
  }
}

// ★★ WHETHER THIS PHONE SHOULD RELOAD ITSELF INTO THE NEW BUILD (v383), decided with no browser so it
// can be pinned. The rules are the same three `decide` uses, and they must never disagree: the reload
// is the ACTION and the strip is the EXPLANATION of the same fact.
//
//   no answer, current, or the phone is ahead of the site → no
//   behind, and a reload has not been tried for that build → yes, once
//   behind, and it HAS been tried → no. ⚠️⚠️ THIS IS THE ANTI-LOOP RULE AND IT IS THE IMPORTANT ONE:
//     a phone reloading into the same stale build — a wedged deploy, a proxy serving an old file —
//     would reload for ever and the person would never reach a lock screen again.
export function shouldReload({ running, deployed, tried } = {}) {
  if (!deployed || !running || deployed === running) return false;
  const site = num(deployed);
  const mine = num(running);
  if (site !== null && mine !== null && site < mine) return false; // phone is ahead — not a problem
  return !tried;
}

// Reload ONCE, before the lock, if this phone is behind. Returns true when a reload is on its way, and
// the caller must then do nothing else — the page is being replaced under it.
//
// ⚠️⚠️ WHY BEFORE THE LOCK AND NOT AFTER THE PIN. The app locks on EVERY open, so reloading after a
// correct PIN would show the lock again and make everyone type the PIN twice, every time — and avoiding
// that would mean remembering the unlock across a reload, which weakens the gate. Doing it first costs
// nothing: the person keys the PIN once and is already in the current build. **The lock's behaviour is
// not touched by this at all.**
export async function maybeReloadForUpdate({ running, fetchImpl } = {}) {
  if (typeof location === "undefined" || typeof location.reload !== "function") return false;
  const deployed = await deployedBuild({ fetchImpl });
  const tried = deployed !== null && readTried() === String(deployed);
  if (!shouldReload({ running, deployed, tried })) return false;
  // Recorded BEFORE the reload, because the record has to survive it — that is what stops the loop.
  noteTried(String(deployed));
  location.reload();
  return true;
}

// What, if anything, to tell her. Pure: the three cases and their wording are
// the whole of it, so a test can pin them without a browser.
//
//   no answer, same build, or a build this phone is already ahead of → nothing
//   behind, and a reload has not been tried yet → offer the reload
//   behind, and a reload was already tried → say so, and name the next step
//
// That last case is the honest one. A reload inside the ten-minute window can
// still be answered from the cache, so a tap that quietly did nothing would be
// a dead control; instead the strip changes its words and stops offering it.
export function decide({ running, deployed, tried } = {}) {
  if (!deployed || !running || deployed === running) return null;
  const site = num(deployed);
  const mine = num(running);
  if (site !== null && mine !== null && site < mine) return null; // phone is ahead — not a problem to act on
  if (tried) {
    return {
      tone: "wait",
      lead: "Still not updated — ",
      text: `this phone has v${running}, the site has v${deployed}. Close the app completely and open it again.`,
    };
  }
  return {
    tone: "update",
    lead: "New version ready — ",
    text: `this phone has v${running}, the site has v${deployed}. Save what you are writing, then update.`,
    label: "Update now",
  };
}

function paint(host, info, onUpdate) {
  if (!info) {
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  const kids = [el("p", { class: "update-bar-msg" }, el("b", {}, info.lead), info.text)];
  if (info.label) kids.push(button(info.label, onUpdate, "small primary"));
  host.replaceChildren(el("div", { class: "update-bar-inner" }, ...kids));
  host.hidden = false;
}

// Watch from now on: once at the start, and again every time the app comes back
// to the screen — which is the case the service worker cannot fix, because an
// already-open tab keeps its modules in memory however fresh the network is.
// Returns the stop function, matching the other views.
export function startFreshnessWatch({ running, fetchImpl } = {}) {
  if (typeof document === "undefined" || typeof window === "undefined") return () => {};
  const host = document.getElementById("update-bar");
  if (!host) return () => {};
  let stopped = false;

  const check = async () => {
    const deployed = await deployedBuild({ fetchImpl });
    if (stopped) return;
    const tried = deployed !== null && readTried() === String(deployed);
    paint(host, decide({ running, deployed, tried }), () => {
      if (deployed === null) return;
      noteTried(String(deployed));
      location.reload();
    });
  };

  const onWake = () => { if (!document.hidden) check(); };
  check();
  document.addEventListener("visibilitychange", onWake);
  window.addEventListener("focus", onWake);
  window.addEventListener("online", check);

  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onWake);
    window.removeEventListener("focus", onWake);
    window.removeEventListener("online", check);
  };
}
