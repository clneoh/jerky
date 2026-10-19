// test/v596-repairs.test.js — seams a Node test cannot drive, pinned at the source.
//
// ⚠️ EVERY CHECK HERE IS A SOURCE OR SQL CHECK AND IS NAMED AS ONE. The date guard is driven in
// history.test.js; the rest sit inside shells this suite cannot press.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("★★★ an order of absurd lines moves no count at all (v596)", () => {
  // ⚠️ SQL CHECK: her database runs these. ⚠️ The per-line 100 stops one line; a hundred such lines still added
  // to 10,000 and zeroed a day.
  const shared = read("supabase/shared_pool_slots.sql");
  assert.match(shared, /total_wanted > 200/, "the shared-pool trigger has no whole-order ceiling");
  assert.match(shared, /day_qty := day_qty \+ pqty/, "a pack's PIECES are not counted toward the day");
  assert.match(read("supabase/instant_slots.sql"), /total_wanted > 200/,
    "the retired trigger has no whole-order ceiling");
});

test("★★★ the advisor file cannot abort on a missing alert table (v596)", () => {
  assert.match(read("supabase/advisor_fixes.sql"), /to_regclass\('public\.order_alert_errors'\) is null/,
    "★ the key repair still evaluates ::regclass blind — 42P01 stops the file");
});

test("★★★ an instruction to her never prints on the shop's sheet (v596)", () => {
  assert.match(read("admin/js/views/po.js"), /po-snapshot-note no-print/,
    "the live PO's paper still tells the shop to tap Bought");
  assert.match(read("admin/js/views/history.js"), /po-snapshot-note no-print/,
    "the history row's instruction still prints");
});

test("★★★ a phone that cannot print says so, before any class is set (v596)", () => {
  const src = read("admin/js/views/poTable.js");
  const guard = src.indexOf('This phone can\'t print');
  const cls = src.indexOf('document.body.classList.add("po-shop-print")', src.indexOf("function printOneShop"));
  assert.ok(guard > 0, "printOneShop has no no-print guard");
  assert.ok(cls > guard, "★ the guard sits after the classes — an unprinted press still scopes the next one");
});

test("★★★ no Points means no chosen Point (v596)", () => {
  const src = read("store/app.js");
  const branch = src.indexOf("if (!points.length) {");
  assert.ok(branch > 0, "the empty-Points branch moved");
  assert.match(src.slice(branch, branch + 400), /wrap\._pointId = "";/,
    "★ a deleted Point stays chosen and is named on the order and in the WhatsApp message");
});

test("★★★ the homepage retries a failed settings read (v596)", () => {
  const src = read("home.js");
  assert.match(src, /devLoaded = true;\s+\/\/ ⭐ only now/, "the latch is set before the fetch again");
});

test("★★★ the homepage price choice is a FOCACCIA (v596)", () => {
  assert.match(read("admin/js/views/settings.js"), /\/focaccia\/i\.test\(String\(p\.name\)\)/,
    "★ a pack can still be chosen to price a card headed FOCACCIA");
});

test("★★ a parcel label has no bare TO heading (v596)", () => {
  const src = read("admin/js/views/orders.js");
  assert.match(src, /const phone = String\(first\.whatsapp \|\| ""\)\.trim\(\);\s*\n\s*if \(customer \|\| phone \|\| recipientAddress\.length\) rows\.push\(\["mail-sec", "TO"\]\);/,
    "★ TO prints with nothing under it");
});

test("★★ the invoice pop-up and its paper wear ONE number (v596)", () => {
  assert.match(read("admin/js/views/orders.js"), /showPopup\(`Invoice #\$\{invoiceNo\(whole\)\}`/,
    "★ the pop-up title numbers from the day's slice while the sheet numbers the whole sale");
});
