// test/v599-repairs.test.js — the verification sweep's seams.
//
// ⚠️ SOURCE AND SQL CHECKS, NAMED AS SUCH. The damaged-book restore, the unsaved edit, the money
// arithmetic, the mixed pack and the day answer are DRIVEN in sync.test.js, order-stage-whole-order.test.js,
// bom.test.js and store.test.js. What is here sits in shells, browser focus or SQL this suite cannot press.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("★★★ a damaged book keeps the unsent edit AND the cloud's settings (v599)", () => {
  const sync = read("admin/js/sync.js");
  assert.match(sync, /const restorePending = forceCloud && pending && !pending\._deleted/,
    "★ the forced read still skips the cloud row — **the offline edit is lost and tombstoned**");
  assert.match(sync, /if \(!forceCloud && \(localNewerOrSame \|\| cloudAt <= localAt\)\) \{/,
    "★ the settings branch ignores the forced read — **the healed phone pushes factory settings**");
  assert.match(sync, /if \(resend\) state\.settings = \{ \.\.\.state\.settings, \.\.\.pending\.data \}/,
    "an unsent settings change is dropped by the heal");
});

test("★★★ the import release is checked before the order is discarded (v599)", () => {
  const src = read("admin/js/supabase.js");
  const at = src.indexOf("const released = await fetch");
  assert.ok(at > 0, "the release is fire-and-forget again");
  assert.ok(src.indexOf("if (released) discardImportedRows(state, ids);", at) > at,
    "★ the rows are removed before the queue row can be retried — **the order exists nowhere**");
});

test("★★★ a forgotten name-only customer cannot come back (v599)", () => {
  assert.match(read("admin/js/profiles.js"), /profileKey/,
    "the redaction carries no profile key — a name-only person has no `who` to match");
  assert.match(read("admin/js/state.js"), /profileKeys\.has\(String\(c\.key \|\| ""\)\)/,
    "the profile filter ignores the key");
  assert.match(read("admin/js/views/customers.js"), /o\.redactedKey === r\._key/,
    "★ the Forget press is still drawn on a row reading `Details removed`");
});

test("★★★ the homepage arms its retry on a failed answer, not only a thrown one (v599)", () => {
  const src = read("home.js");
  assert.match(src, /if \(!res\.ok\) \{ armDevRetry\(\); return; \}/,
    "★ a 503 returns early and latches for the whole visit");
  assert.match(src, /if \(!Array\.isArray\(rows\)\) \{ armDevRetry\(\); return; \}/,
    "an unreadable answer latches too");
  assert.match(src, /function armDevRetry\(\)/, "the retry has no single home");
});

test("★★ the homepage product is a real product, never a pack (v599)", () => {
  const src = read("admin/js/supabase.js");
  assert.match(src, /isPoolablePack\(state, pick\) !== null\) return ""/,
    "★ a stale pack id still prices the loaf's card");
  assert.match(src, /hit && isPoolablePack\(state, hit\) === null/,
    "a published pack name can still be adopted onto the loaf");
  assert.match(src, /\(state\.products \|\| \[\]\)\.length\) \{/,
    "an empty product list can still overwrite the published choice");
});

test("★★★ the review section knows which review is on screen (v599)", () => {
  assert.match(read("reviews.js"), /reviews\?select=id,name,stars/,
    "★ the query does not select the id the carousel compares");
  assert.match(read("reviews.js"), /drawGrid\(\);\s*\n\s*if \(!rowsCache\) loadApproved\(\)/,
    "★ a failed note stays in the old language because the answer is discarded");
});

test("★★★ a dialog the action opened keeps focus (v599)", () => {
  const ui = read("admin/js/ui.js");
  const at = ui.indexOf("function restoreOpener()");
  assert.ok(at > 0, "restoreOpener moved");
  assert.match(ui.slice(at, at + 900), /if \(active && active !== opener && insideOpenCard\(active\)\) return;/,
    "★ the title fallback steals focus from the refund card it just opened");
});

test("★★ the refund boxes and calendar days say which one they are (v599)", () => {
  assert.match(read("admin/js/views/orders.js"), /How many came back — \$\{line\.name/,
    "every refund box shares one name");
  assert.match(read("admin/js/views/products.js"), /tipText \? `\$\{longDate\(d\)\}, \$\{tipText\}` : longDate\(d\)/,
    "★ the occasion drops out of the day's name");
  assert.match(read("admin/js/views/deliveries.js"), /class: `\$\{cls\} tappable`, "aria-label": longDate\(date\)/,
    "an add-mode day has no name");
});

test("★★ no instruction or app route prints on a customer's or an accountant's sheet (v599)", () => {
  assert.equal(/Pick another period\./.test(read("admin/js/consolidated.js")), false,
    "★ an instruction prints in the empty statement");
  assert.equal(/where: "More → Profit"/.test(read("admin/js/views/profit.js")), false,
    "★ the P&L footer hands an accountant an app route");
  assert.match(read("admin/js/views/po.js"), /class: "warn no-print"/,
    "the PO warnings print for the shop");
  assert.match(read("admin/js/views/po.js"), /class: "no-print"/,
    "the empty preview's instruction prints");
});

test("★★★ the live trigger counts an unlimited product's line, and only a pack is excluded (v599)", () => {
  // ⚠️ SQL CHECK: her database runs this. ⚠️ v598's ROW_COUNT gate skipped every product with no
  // `product_availability` row — i.e. an unlimited one — so the day never dropped for them.
  const src = read("supabase/shared_pool_slots.sql");
  assert.match(src, /elsif not exists \(/, "★ an unlimited product's sale no longer counts toward the day");
  assert.match(src, /where pa\.date = odate and pa\.product = lname/, "the exclusion is not a pack lookup");
  assert.match(src, /if t_qty >= 1 then total_wanted := total_wanted \+ t_qty; end if;/,
    "★ a forged pool qty is outside the whole-order ceiling again");
});
