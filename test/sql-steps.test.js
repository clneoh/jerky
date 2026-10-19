// test/sql-steps.test.js — the database steps this app tells her to run must
// actually contain the thing they say they contain.
//
// ⚠️⚠️ WHY THIS FILE EXISTS, AND IT IS NOT A HYPOTHETICAL. On 17 Oct 2026 THIS app
// shipped v533 with a changelog reading "RUN supabase/sync_cursor.sql IN YOUR
// SUPABASE SQL EDITOR BEFORE YOU DEPLOY THIS" — ⭐ **and the file was 0 bytes.**
// She ran it, it did nothing, and nothing anywhere said so: the app's own fallback
// quietly read the whole book instead. ⭐⭐ **A promised step that is empty looks
// exactly like a step that worked, and a graceful fallback is what makes the
// difference invisible.** She was then told, in good faith, that the step was
// confirmed. It was not.
//
// ⭐ So this checks the FILE, not the prose: it must exist, it must not be empty,
// and it must carry the statements that make the code's query possible.
//
// ⚠️ And it deliberately does NOT try to run the SQL — there is no database here,
// and a fake one would prove nothing about the real table.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const step = (name) => {
  const p = join(ROOT, "supabase", name);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

test("★★★ every SQL step in the repo has instructions in it", () => {
  // ⭐ THE BLUNT ONE FIRST, because it is the fault that actually happened: a file
  // that exists, is tracked, is named in a changelog — and is empty.
  const dir = join(ROOT, "supabase");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  assert.ok(files.length > 10, `the SQL steps were not found at all (${files.length}), so this proves nothing`);
  const empty = files.filter((f) => readFileSync(join(dir, f), "utf8").replace(/--[^\n]*/g, "").trim().length === 0);
  assert.deepEqual(empty, [],
    "★ a database step she could be told to run is EMPTY (or comments only) — she would paste it, see "
    + "'Success', and nothing would have happened");
});

test("★★★ sync_cursor.sql exists, is NOT EMPTY, and creates what the pull asks for", () => {
  const sql = step("sync_cursor.sql");
  assert.ok(sql !== null, "★ the database step the incremental sync promises does not exist at all");
  // ⚠️⚠️ THE EXACT FAULT: a 0-byte file, told to her as a step.
  assert.ok(sql.replace(/--[^\n]*/g, "").trim().length > 100,
    "★ sync_cursor.sql is EMPTY (or comments only) — **a step she is told to run that does nothing "
    + "looks exactly like one that worked, and the app's fallback hides the difference**");

  // ⭐ THE COLUMN THE QUERY NAMES.
  assert.match(sql, /add column if not exists seq/i,
    "★ no `seq` column is created — **the cursor read asks for a column that would not exist**");
  // ⚠️⚠️ AND THE HALF THAT IS EASY TO GET WRONG: a plain DEFAULT only fires on
  // INSERT, so an EDITED row would keep its old number and sit behind the cursor
  // for ever. ⭐ The number has to be stamped on update too.
  assert.match(sql, /before\s+insert\s+or\s+update/i,
    "★ nothing stamps `seq` on an UPDATE — **a default fires on insert only, so every edit would keep "
    + "its old number and never be seen again**");
  // ⚠️ AND THE WRITE PATH MUST BE ALLOWED TO ASK THE SEQUENCE FOR ONE — without
  // this every push from a phone is refused, and syncing stops entirely.
  assert.match(sql, /grant[\s\S]{0,80}on sequence[\s\S]{0,80}authenticated/i,
    "★ the signed-in role is not granted USAGE on the sequence — **every write from a phone would fail "
    + "with 'permission denied for sequence', which breaks syncing completely rather than slowing it**");
  // ⭐ AND IT MUST BE SAFE TO RUN TWICE, because she will be told it is.
  assert.match(sql, /create sequence if not exists/i, "the sequence is not guarded, so a second run fails");
  assert.match(sql, /add column if not exists/i, "the column is not guarded, so a second run fails");
  assert.match(sql, /drop trigger if exists/i, "the trigger is not replaced, so a second run fails");
});

test("★★★ incoming_cleanup.sql can no longer DELETE a waiting order (v585)", () => {
  const raw = step("incoming_cleanup.sql");
  assert.ok(raw !== null, "the cleanup file is gone — say so in the changelog rather than dropping it silently");
  // ⚠️⚠️ MEASURED FAULT: the file deleted every queued order older than an hour, ⚠️ **and that queue is the
  // only copy of an order until a phone imports it — both phones off overnight, and a re-run destroyed real
  // orders.** ⭐ "Run once" was a comment, not a guard.
  const sql = raw.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.doesNotMatch(sql, /\bdelete\s+from\s+incoming_orders/i,
    "★ an executable sweep of the queue is back — **the only copy of a waiting order can be deleted by re-running a file that says it is safe**");
  // And it still TELLS her something: a select, so running it is useful and harmless.
  assert.match(sql, /select[\s\S]*from\s+incoming_orders/i,
    "the file neither cleans nor reports — it should show her what is waiting");
});

test("★★ an anonymous order row may not be a megabyte (v585)", () => {
  // ⚠️ The shop has no login, so every row in incoming_orders was written by a stranger. ⚠️ **Unlimited fake
  // orders are accepted by design — the SHAPE is not.** ⭐ A real cart is a few hundred characters.
  const sql = step("storefront.sql");
  assert.ok(sql !== null, "storefront.sql is missing");
  assert.match(sql, /constraint incoming_orders_data_size check \(octet_length\(data\) <= \d+\)/i,
    "★ an anonymous insert can carry a payload of any size again");
});
