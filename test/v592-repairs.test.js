// test/v592-repairs.test.js — seams a Node test cannot drive, pinned at the source.
//
// ⚠️ EVERY CHECK HERE IS A SOURCE OR SQL CHECK AND IS NAMED AS ONE. The behaviours themselves are driven
// elsewhere: the redaction in sync.test.js/profiles.test.js, the date repair in state.test.js, the bake-row
// cleanup and the Un-bought refusal in stock.test.js, the WhatsApp message in store.test.js, the invoice
// date in invoice.test.js, the voids sentence in consolidated.test.js, the print guard in ui.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("★★★ every shop day being full makes Place order SAY it (v592)", () => {
  // ⚠️ SOURCE CHECK: the handler is inside the shop's own closure and this suite cannot press it with every
  // day sold out. ⚠️ The guard was a silent `return` — no message, no scroll, no order.
  const src = read("store/app.js");
  assert.equal(/if \(!selected\) return;/.test(src), false,
    "★ the no-day guard is silent again — **a full basket and a press do nothing at all**");
  assert.match(src, /sayStepFirst\("needDayTitle", "needDayBody", "step1", t\("noOpenDates"\)\)/,
    "★ the day step no longer refuses in the all-days-full words");
});

test("★★★ an absurd line cannot zero a whole bake day (v592)", () => {
  // ⚠️ SQL CHECK: these run on the database, not here. ⚠️ qty 999 passed the old `> 999` guard and zeroed a
  // realistic day; a real line is a few dozen pans.
  for (const file of ["supabase/shared_pool_slots.sql", "supabase/instant_slots.sql"]) {
    const src = read(file);
    assert.match(src, /lqty > 100/, `${file}: the per-line ceiling is not 100`);
    assert.equal(/lqty > 999/.test(src), false, `${file}: the 999 ceiling is back`);
  }
  // ⚠️ v598: the pool row is an AGGREGATE of pieces (26 four-packs is 104), so the per-row cap is gone and the
  // whole-order ceiling bounds it instead.
  assert.match(read("supabase/shared_pool_slots.sql"), /total_wanted > 200/,
    "the pool order is not bounded at all");
});

test("★★ the advisor file cannot abort on a project without those functions (v592)", () => {
  // ⚠️ SQL CHECK: a revoke naming a missing function is an ERROR that stops the file before the key repair.
  const src = read("supabase/advisor_fixes.sql");
  assert.match(src, /to_regprocedure\('public\.alert_new_order\(\)'\)/, "the revoke is unguarded");
  assert.match(src, /to_regprocedure\('public\.decrement_slots_on_order\(\)'\)/, "the second revoke is unguarded");
});

test("★★ every print path's fallback is long enough to finish rendering (v592)", () => {
  // ⚠️ SOURCE CHECK: the duration is a timer in a browser. ⚠️ Two seconds stripped the print classes while a
  // slow preview was still rendering, so a label printed on the printer's default paper.
  for (const file of ["admin/js/views/orders.js", "admin/js/views/poTable.js",
    "admin/js/journal.js", "admin/js/views/receipt_register.js"]) {
    const src = read(file);
    assert.match(src, /setTimeout\(done, 10000\)/, `${file}: the print fallback is not ten seconds`);
    assert.equal(/setTimeout\(done, 2000\)/.test(src), false, `${file}: the two-second strip is back`);
  }
});

test("★★ the lookup's own budget stays under the shop's patience (v592)", () => {
  // ⚠️ SOURCE CHECK: the timers run on opposite sides of the wire. ⚠️ Equal budgets meant a place found at
  // 11.9 s always lost: the page had already given up and reported a failure that was still coming.
  const fn = read("supabase/functions/shop-geocode/geocode.ts");
  const at = fn.match(/Math\.floor\((\d+) \/ queue\.length\)/);
  assert.ok(at, "the per-ask budget moved — this check is watching nothing");
  assert.ok(Number(at[1]) < 12000, "★ the server's whole budget is not under the caller's 12 s");
});
