// test/v598-repairs.test.js — the fifth sweep's seams, pinned at the source.
//
// ⚠️ SOURCE AND SQL CHECKS, NAMED AS SUCH. The damaged-book restore, the split-order freeze and the
// accumulating refund are DRIVEN in sync.test.js and order-stage-whole-order.test.js; the date guard in
// history.test.js. Everything here sits in shells, SQL, or browser print paths this suite cannot press.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("★★★ a damaged book forces the cloud's rows and holds until they land (v598)", () => {
  const sync = read("admin/js/sync.js");
  assert.match(sync, /forceCloud: wasUnreadable/, "a damaged book no longer forces the cloud's rows");
  assert.match(sync, /!forceCloud && cloudAt <= localAt/, "the timestamp skip ignores the forced read");
});

test("★★★ the damaged copy cannot be deleted into a tombstone (v598)", () => {
  const state = read("admin/js/state.js");
  const at = state.indexOf("export function dropUnreadableCopy");
  assert.ok(at > 0, "the press moved");
  assert.match(state.slice(at, at + 900), /removedAt: new Date\(\)\.toISOString\(\)/,
    "★ deleting the kept copy releases the hold — the next save can empty the cloud");
});

test("★★★ an edit that pays for the extra moves the frozen sale; undo keeps it (v598)", () => {
  const orders = read("admin/js/views/orders.js");
  // ⚠️ v599: the refreeze is an ADDITION (`refreezeBy`), not a substitution — see v599-repairs.
  assert.match(orders, /refreezeBy: extraPaid/, "★ paying the extra never reaches the frozen sale");
  assert.match(orders, /for \(const o of familyOfOrder\(state, group\.orders\)\) \{\s*\n\s*o\.paidWasRM = /,
    "the refreeze is written to the whole sale");
  const undoAt = orders.indexOf("function undoRefundOrder");
  assert.ok(undoAt > 0, "the undo moved");
  assert.equal(/delete o\.paidWasRM;/.test(orders), false,
    "★ undoing a refund drops the frozen sale — the money she keeps vanishes from the books");
});

test("★★ the profit journal explains a frozen sale (v598)", () => {
  assert.match(read("admin/js/profit.js"), /The sale as it was paid — before it was edited down/,
    "★ the journal sums to less than its own Sales line");
});

test("★★ what is still owed survives a partial refund (v598)", () => {
  assert.match(read("admin/js/money.js"), /const stillOwed = round2\(Math\.max\(0, billTotal - back\)\)/,
    "★ an unpaid order with a refund reads as nothing owed");
});

test("★★★ the homepage product choice offers no value pack (v598)", () => {
  assert.match(read("admin/js/views/settings.js"), /isPoolablePack\(state, p\) === null/,
    "★ a 4 × Focaccia Box can be picked to price the loaf's card");
  assert.match(read("home-facts.js"), /\.sort\(\(a, b\) => Number\(a\.price\) - Number\(b\.price\)\)/,
    "the contains fallback can still pick a pack");
});

test("★★★ the homepage retries a failed settings read (v598)", () => {
  const src = read("home.js");
  // ⚠️ MUNCHIES' HOMEPAGE CALLS IT `loadPublished` — the same read, renamed here because it fills the
  // footer's contacts as well as the developer credit.
  assert.match(src, /addEventListener\("online", \(\) => loadPublished\(\)\)/, "no retry when the phone returns");
  assert.match(src, /retryTimer = setTimeout\(\(\) => \{ retryTimer = null; loadPublished\(\); \}, 30000\)/,
    "a failed read still latches for the whole visit");
});

test("★★ a language switch keeps the review and its place (v598)", () => {
  const src = read("reviews.js");
  // ⚠️ v599: draw first, then re-read only when nothing is cached.
  assert.match(src, /drawGrid\(\);\s*\n\s*if \(!rowsCache\) loadApproved\(\)/,
    "★ a failed load's note stays in the old language");
  assert.match(src, /buildCarousel\(rows, currentReviewId\)/, "★ a language switch throws the reader to slide 1");
  assert.match(read("store/app.js"), /\(CONFIG\.products \|\| \[\]\)\.length \? t\("noMenuToday"\) : t\("noMenu"\)/,
    "an empty menu still says 'pick another day'");
});

test("★★ the shop's carousels and calendars say their state (v598)", () => {
  const shop = read("store/app.js");
  assert.match(shop, /d\.setAttribute\("aria-pressed", k === i \? "true" : "false"\)/,
    "the promo dots are colour-only");
  assert.match(shop, /if \(!open\.length\) \{\s*\n\s*focusIso = null;/, "a stale focus key survives the full-day branch");
  assert.match(shop, /close\(\{ hand: false \}\); try \{ onGo\(\); \} finally \{ restore\(\); \}/,
    "the change-method question restores focus before its action rebuilds the list");
});

test("★★ the backoffice dialogs and calendars are named (v598)", () => {
  const ui = read("admin/js/ui.js");
  assert.match(ui, /document\.getElementById\("view-title-text"\)/,
    "★ a delete that rebuilds the screen leaves focus on the body");
  const reviews = read("admin/js/views/reviews.js");
  assert.match(reviews, /sl\.style\.visibility = j === cur \? "" : "hidden"/,
    "★ Tab reaches the hidden slides' buttons");
  for (const [file, why] of [
    ["admin/js/views/deliveries.js", "the bake-day calendar"],
    ["admin/js/views/products.js", "the availability calendar"],
  ]) {
    assert.match(read(file), /"aria-label": (tipText \? `\$\{longDate\(d\)\}, \$\{tipText\}` : )?longDate\(/,
      `${why}'s days are still named by their number`);
  }
});

test("★★★ the live slot trigger counts a pack ONCE toward the day (v598)", () => {
  // ⚠️ SQL CHECK: her database runs this. ⚠️ v596 added both the line's qty and the pool's pieces.
  const src = read("supabase/shared_pool_slots.sql");
  // ⚠️ v599: an unlimited product (no row) still counts; only a derived pack row is excluded.
  assert.match(src, /if hits > 0 then\s*\n\s*day_qty := day_qty \+ lqty;\s*\n\s*elsif not exists \(/,
    "★ a pack line still adds its own qty as well as its pieces — or an unlimited line no longer counts");
  assert.match(src, /if pqty < 1 or pname = '' then/, "the pool row is capped at 100 again — a legitimate large pack order is ignored");
  assert.match(src, /total_wanted > 200/, "the whole-order ceiling is gone");
  assert.match(read("supabase/advisor_fixes.sql"), /to_regclass\('public\.order_alert_errors'\) is not null\s*\n\s*and conrelid = to_regclass/,
    "★ the advisor file's last select still aborts on a project without the table");
});

test("★★ no instruction to her prints on a customer's or a shop's sheet (v598)", () => {
  assert.equal(/Open this invoice again once the phone is back online/.test(read("admin/js/receipts.js")), false,
    "★ the invoice tells the customer to reopen an app on her phone");
  assert.match(read("admin/js/views/receipt_register.js"), /card-sub no-print/, "the register's paper instructs its reader");
  assert.match(read("admin/js/views/poTable.js"), /warn no-print/, "the PO's unit warning prints for the shop");
  assert.equal(/More → Ingredients/.test(read("admin/js/views/profit.js")), false,
    "the P&L note hands an accountant an app route");
});

test("★★ an unknown booking stays UNKNOWN through every client seam (v598)", () => {
  assert.match(read("admin/js/couriers/lalamove.js"), /unknown: true,\s*\n\s*reason: `\$\{LALAMOVE_LABEL\} took the booking/,
    "★ an unnamed trip reply leaves the Book press live");
  assert.match(read("supabase/functions/parcel/easyparcel.ts"), /unknown: true, reason: "EasyParcel did not answer with an order\."/,
    "a readable reply with no order row is a refusal");
  assert.match(read("admin/js/views/delivery_run.js"), /let bookUnknown = \(state\.orders \|\| \[\]\)\.some/,
    "★ reopening the run resurrects every Book press under an unknown trip");
});
