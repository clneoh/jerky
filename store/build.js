// store/build.js — "is the shop page in my hand the newest one?"
//
// ★★ WHY THIS FILE EXISTS (v492). GitHub Pages serves `store/` with `cache-control: max-age=600`
// and no build number in any URL, so a price change, a closed day or a new field can be pushed and
// NOT arrive. ⚠️ **The backoffice has had a strip saying so since v255; the shop never did** — and
// it matters more here, because the person reading it is a CUSTOMER, who has no way of knowing, and
// an order placed against old code is a real order placed wrongly.
//
// ⭐ THE DECISION IS A COMPARISON OF TWO NUMBERS, so it lives here on its own, with no DOM and no
// storage and no network in it — the same shape as `pool.js`, `calendar.js` and `geo.js` beside it.
// `store/app.js` does the asking (and it cannot be imported by a test at all: it calls `render()`
// at the top level). **Everything worth pinning about this feature is in this file.**
//
// ⭐ SELF-CONTAINED ON PURPOSE. The baker's own plan is that munchies copies this from the bakery
// afterwards, so it is one leaf module with one export and no other file to bring along.

// ⚠️⚠️ AND THIS FILE NO LONGER IMPORTS THE VERSION AT ALL (v496). It used to, so that `newerBuild` had a
// default to fall back on — ⭐ **and that default is what made the notice blind**: the page measured itself
// with the number from the very file it was probing. **The running build is now passed in by the caller,
// from a literal in the file that runs.** See `store/app.js`'s `SHOP_BUILD`.

// The little file that says which build the SITE is serving right now. ⚠️ Relative, because the
// shop is served from `/store/` and the version file lives in `/admin/js/` — the same path the
// page's own `Engine v<n>` footer reads.
export const VERSION_URL = "../admin/js/version.js";

// ⚠️ IT MUST KEEP MATCHING `admin/js/version.js` ITSELF. A reformat that stopped this pattern
// matching would kill the notice SILENTLY — the page would simply never speak again, and nothing
// would look broken. `test/store-build-notice.test.js` pins it against the real file for exactly
// that reason.
//
// ⚠️⚠️ AND THE VALUE MUST BE DIGITS, NOT "ANYTHING BETWEEN QUOTES". A looser `([^"']+)` would read
// `ENGINE_VERSION = "v492"` as the build `v492`, decide it differed from `492`, and **put a
// "close this page and open it again" bar over a bakery's prices because of a change to a build
// script.** ⭐ Requiring digits makes anything unexpected fall through to `false` — the direction
// that costs a customer nothing.
const VERSION_RE = /ENGINE_VERSION\s*=\s*["'](\d+)["']/;

/**
 * Which build does this text declare? `null` when it declares none this code can read.
 *
 * ⚠️⚠️ IT IS ITS OWN EXPORTED FUNCTION, AND IT HAS TO BE. `newerBuild` answers `false` in two very
 * different situations — *"the two agree"* and *"I could not read the file at all"* — and that is
 * the right answer for both. ⭐ But it also means **a test that only asks `newerBuild` cannot tell
 * the two apart**: it would happily pass with the pattern broken, because "cannot read" and "same
 * build" are the same `false`. ⚠️ That is the fault class this repo keeps paying for — an assertion
 * that passes whatever happened — so the read is asked for separately and can be proved on its own.
 *
 * @param {string} servedText the version file exactly as the site handed it over
 * @returns {string|null} the number it declares, or `null`
 */
export function buildIn(servedText) {
  const m = VERSION_RE.exec(String(servedText == null ? "" : servedText));
  return m ? m[1] : null;
}

/**
 * Is the page the site is serving a DIFFERENT build from the one running here?
 *
 * @param {string} servedText the version file exactly as the site handed it over
 * @param {string} running    **the build the CALLING FILE is — and the caller must say so**
 * @returns {boolean} true when they differ — and **false whenever that cannot be told**
 *
 * ⚠️⚠️ `running` HAS NO DEFAULT, AND THAT IS THE FIX IN v496. It used to fall back to the build imported
 * from `admin/js/version.js` — ⭐ **which is the very file this function is given the text of.** A page
 * whose `store/app.js` was old and whose `version.js` had been revalidated therefore compared the SITE's
 * number with the SITE's number, agreed, and said nothing: **a shop running month-old code reporting
 * itself as current**, which is the one fault this whole feature exists to catch.
 * ⭐ So the caller passes `SHOP_BUILD` — a literal written into the file that runs — and a stale page
 * carries its own honest number with it. **Making the argument required is what stops the mistake coming
 * back quietly**: there is no longer a default that anyone could lean on by accident.
 *
 * ⚠️⚠️ IT ANSWERS **FALSE** WHEN IT CANNOT TELL, and that is the whole safety of it. An empty
 * answer, a stub, a file that is not a version file, a build number it cannot read — every one of
 * them is "no". **A page that cried "out of date" on a bad connection would be worse than one that
 * never spoke**, and the customer has done nothing wrong. ⭐ The doubt is spent on silence.
 *
 * ⚠️ AND IT IS AN INEQUALITY, NOT A "GREATER THAN". The two numbers are opaque handles, not a
 * sequence: the only honest question is whether they are the SAME one. A phone holding a stale
 * *version file* would make this page look AHEAD of the site, and that is just as wrong as being
 * behind — **both deserve the same sentence.**
 */
export function newerBuild(servedText, running) {
  const seen = buildIn(servedText);
  return seen === null ? false : seen !== String(running);
}

// ⚠️ WHERE THE "I ALREADY TRIED RELOADING" FLAG IS KEPT, and why it is `sessionStorage` rather
// than memory or `localStorage`: a page reload WIPES MEMORY, which is the entire problem being
// solved here, and `localStorage` would forget at the wrong moment — it would carry the flag into
// tomorrow's visit and hide a genuine notice. ⭐ One session, one honest answer.
// ⚠️ The key names the site, so the bakery's shop and munchies' shop on the same phone can never
// read each other's flag.
// ⚠️⚠️ JERKY'S OWN KEY, NOT THE BAKERY'S — **the app's own guardrail: internal ids stay
// origin-scoped**, and both shops run on the same phones. (`bakeadmin.shop.build` in the bakery's
// copy of this file, and the two must never be able to read each other's flag.)
export const BUILD_TRIED_KEY = "munchies.shop.build";

/**
 * WHICH FILES A RELOAD HAS TO RE-ASK FOR, given the resources this page loaded (v656).
 *
 * @param {Array<{name?: string}>} entries `performance.getEntriesByType("resource")`
 * @param {string} origin                this site's own origin
 * @returns {string[]} the same-origin addresses, each once
 *
 * ⚠️⚠️ WHY THIS EXISTS — THE FAULT SHE REPORTED ON 2026-10-27, *"it fail to refresh again on browser"*.
 * **A plain `location.reload()` re-asks for the PAGE and takes every other file from the browser's
 * own copy.** GitHub Pages serves `/store/` with `cache-control: max-age=600`, so for ten minutes
 * the page comes back new while `app.css` and every module beside it come back old — the press
 * lands on a page that looks untouched, and pressing it again cannot help.
 * ⭐ **That is not the build being wrong; it is only the page being re-read.** So the press re-asks
 * for the files first (`cache: "reload"` in `store/app.js`), and then reloads — and only a request
 * that really goes to the network puts the new copy where the reload will find it.
 * ⚠️ **THE LIST IS THE PAGE'S OWN, NOT A GUESS**: a module graph is not knowable from here, and a
 * hand-kept list of filenames would go stale on the first file anyone adds. The browser already
 * knows exactly what this page used.
 * ⚠️ Same origin only: the fonts are ours, the geocoder and Supabase are not, and a reload is no
 * reason to re-ask them.
 * ⚠️⚠️ **AND ONLY WHAT A BUILD CHANGES — code, stylesheet and fonts.** A build number never names a
 * photograph, and a press that quietly re-downloaded ten product photos would spend a customer's
 * mobile data to fix something it cannot fix. ⭐ Measured on the live page: the whole resource list
 * is 36 files, of which the photos are the large ones.
 */
const BUILDABLE = /\.(?:js|mjs|css|woff2?|ttf|otf)(?:\?|$)/i;

export function assetsToRefresh(entries, origin) {
  const keep = [];
  const seen = new Set();
  for (const e of Array.isArray(entries) ? entries : []) {
    const name = e && typeof e.name === "string" ? e.name : "";
    if (!/^https?:/i.test(name)) continue;
    let url;
    try { url = new URL(name); } catch { continue; }
    if (origin && url.origin !== origin) continue;
    if (!BUILDABLE.test(url.pathname)) continue;
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    keep.push(url.href);
  }
  return keep;
}
