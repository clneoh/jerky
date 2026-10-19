// test/clear-all.test.js — "Delete all data" clears THIS PHONE, and says so (v576).
//
// ⚠️⚠️ WHAT IT DID: removed only the book, left the sync journal (whose snapshot tombstoned every record and
// wiped the other phone), re-seeded a fresh state that turned the app password back to the shipped 8899, and
// dropped the shared-data sign-in — with none of it said.
//
// ⚠️ The button lives inside `renderSettings`, which cannot be driven here without the whole app, so these are
// SOURCE checks and they are labelled as such. The behaviour they guard is small and the words are the point.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../admin/js/views/settings.js", import.meta.url), "utf8");

// ⚠️⚠️ COMMENTS STRIPPED BEFORE ANY MATCH (v588). A `// sync.clearJournal();` still matched the reader, so the
// one line that keeps the reset from wiping the other phone could be commented out with every guard green.
function live(src) {
  return String(src || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((line) => line.replace(/(^|\s)\/\/.*$/, "")).join("\n");
}

test("★★★ the reset forgets the journal and signs out, so it cannot delete the cloud", () => {
  const block = live(SRC.slice(SRC.indexOf("function clearAll()"), SRC.indexOf("function rowEl(")));
  assert.ok(block.length > 100, "the clearAll block moved — this reader must be pointed at it again");
  assert.match(block, /sync\.clearJournal\(\)/,
    "★ the reset does not forget the sync journal — **its snapshot tombstones every record and wipes the other phone**");
  assert.match(block, /signOut\(\)/,
    "★ the reset leaves the phone signed in, so a fresh empty book can be pushed over the shared one");
  assert.match(block, /saveSafetyCopy/,
    "★ the reset takes no \"before delete\" copy, so nothing can bring the phone's book back");
});

test("★★★ and it says what it touches", () => {
  const block = live(SRC.slice(SRC.indexOf("function clearAll()"), SRC.indexOf("function rowEl(")));
  assert.match(block, /SHARED DATA still holds/,
    "★ the dialog does not say the shared data keeps the book — **she would believe she deleted everything**");
  assert.match(block, /app password goes back to the default/,
    "★ the dialog does not say the PIN returns to the shipped default");
});

test("★★★ an Import with no cloud says it cannot be undone", () => {
  // ⚠️ When shared data is off there is no place for a "before" copy, and the sentence used to simply vanish —
  // a one-way door with no warning at all.
  assert.match(SRC, /no \\"Before import\\" copy can be saved — this cannot be undone/,
    "★ an import without a cloud is silent about having no way back");
});
