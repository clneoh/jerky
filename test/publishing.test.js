// test/publishing.test.js — every page this site publishes states what search engines may do with it, and
// the one folder that must never be crawled says so in robots.txt.
//
// ⚠️⚠️ WHY THIS EXISTS. On 17 Oct 2026 five pages were public and only TWO of them said anything: the promo
// card and the form. ⭐ **The other three — the HOMEPAGE, the SHOP, and the PIN-LOCKED BACKOFFICE — were
// silent**, so whether they were indexed was whatever a crawler happened to do. ⚠️ **A backoffice titled
// "Bakery Backoffice" appearing in a search for bread is a fault nobody would see until it was already listed,
// and a page indexed today is not un-indexed tomorrow.**
//
// ⭐⭐ AND THE INVARIANT IS **SILENCE**, NOT "noindex". ⭐ **Hiding her homepage would work against her own
// words — __"i want to be ready for business in no time"__ — so this file must never force one answer.** It
// asks the smaller, safer question: **is there an answer on the page at all?** A launch is then one deliberate
// line on one page, not a hunt for what was never written down.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
// ⚠️ Folders that are NOT published: `.git` is not a page, `marketing/` is gitignored (so Pages never sees it),
// and `node_modules` is not the site.
const SKIP = new Set([".git", "node_modules", "marketing", ".claude", ".agents", ".DS_Store"]);

function htmlPages(dir = ROOT, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) htmlPages(p, out);
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

const robotsOf = (html) => {
  const m = /<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i.exec(html);
  return m ? m[1].trim().toLowerCase() : null;
};

test("★★★ every page says what search engines may do with it — none is left silent", () => {
  const pages = htmlPages();
  assert.ok(pages.length >= 3, `only ${pages.length} page(s) found — the walker is not seeing the site`);
  const silent = pages
    .map((p) => ({ p: relative(ROOT, p), v: robotsOf(readFileSync(p, "utf8")) }))
    .filter((x) => !x.v);
  assert.deepEqual(silent.map((x) => x.p), [],
    "★ these pages carry NO robots directive — **whether they are indexed is then whatever a crawler happens "
    + "to do, and nobody decided it. Write it out, either way.**");
});

test("★★★ the backoffice is NEVER for search engines", () => {
  // ⚠️ Not a trade-off, unlike the homepage and the shop: a PIN-locked backoffice is not something a customer
  // should be able to find, and its title and name are public the moment it is crawled.
  const v = robotsOf(readFileSync(join(ROOT, "admin/index.html"), "utf8"));
  assert.match(String(v), /noindex/,
    "★ the backoffice can be indexed — **it is PIN-locked, but Google would list its title and the fact it "
    + "exists, and that is not hers to undo quickly**");
});

test("★★★ and the two rules are never used TOGETHER — a blocked crawler cannot read a noindex tag", () => {
  // ⚠️⚠️ THE TRAP, WRITTEN DOWN BECAUSE IT IS THE ONE EASY TO GET WRONG: `Disallow` in robots.txt stops the
  // fetch, so the page's own `noindex` is never seen. ⭐ Both are fine on their own; together the tag is dead.
  const robots = existsSync(join(ROOT, "robots.txt")) ? readFileSync(join(ROOT, "robots.txt"), "utf8") : "";
  const disallowed = [...robots.matchAll(/^\s*Disallow:\s*(\S+)/gim)].map((m) => m[1].trim());
  for (const folder of disallowed) {
    if (!folder || folder === "/") continue;
    const dir = join(ROOT, folder.replace(/^\//, ""));
    if (!existsSync(dir)) continue;
    for (const p of htmlPages(dir)) {
      const v = robotsOf(readFileSync(p, "utf8"));
      assert.doesNotMatch(String(v), /noindex/,
        `★ ${relative(ROOT, p)} is BOTH disallowed in robots.txt and tagged noindex — **the crawler is refused `
        + "the page, so it can never read the tag. Keep one.**");
    }
  }
});

test("★★★ and her working papers are not offered to search engines", () => {
  // ⚠️ The site publishes every tracked file, so the test suite is served at /test/. Nothing secret is in it —
  // every phone number there is an obvious fixture — but it is her working papers, not her shop.
  const robots = existsSync(join(ROOT, "robots.txt")) ? readFileSync(join(ROOT, "robots.txt"), "utf8") : "";
  assert.match(robots, /^User-agent:\s*\*/im, "★ there is no robots.txt, or it names no crawlers");
  assert.match(robots, /^\s*Disallow:\s*\/test\/\s*$/im,
    "★ /test/ is not disallowed — **her 155 working files are offered to every search engine**");
});
