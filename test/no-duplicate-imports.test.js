// test/no-duplicate-imports.test.js — no module may bind one name twice.
//
// ★★ THIS EXISTS BECAUSE THE SAME MISTAKE WAS MADE THREE TIMES IN ONE DAY (8-9 Oct 2026), every time
// while porting a bakery version across, and every time from the SAME resolution shape:
//
//   **A merge conflict was settled by KEEPING BOTH SIDES, and the other side's hunk contained an
//   import line the file already had above it.**
//
//     · v368 — `import { renderReceiptRegister }` three times in `admin/js/app.js`
//     · v382 — a duplicate `bom.js` import in `admin/js/supabase.js`
//     · v393 — a duplicate `dates.js` import in `admin/js/views/money.js`
//
// Each time the symptom looked like a catastrophe — `Identifier 'X' has already been declared`, and
// **every test file in the suite failed to load** — and each time the cause was a line inserted by a
// hand resolution rather than anything wrong with the bakery's change or with this app.
//
// ⚠️ AND EACH TIME THE SUITE CAUGHT IT, which is exactly why this is a TEST and not a checklist item:
// a check nobody runs is the fault it was written for. It is cheap, it never flakes, and it names the
// file and the binding, which is the whole of the diagnosis.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Every module the app loads. `admin/js` is the app; `store` is the shop; the two root scripts are
// the homepage's own (`home.js`, `reviews.js`) and are separate documents from either.
const DIRS = ["admin/js", "store"];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

// `import { a, b as c } from "x"` — the BINDING is `a` / `c`, which is what a second import collides
// with. A default or namespace import (`import x from`, `import * as x`) binds differently and is
// matched separately so a mixed file cannot slip past.
const NAMED = /^\s*import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/gm;
const DEFAULTISH = /^\s*import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s*(?:,|from)\s*["'][^"']+["']/gm;

test("★ no module binds the same imported name twice", () => {
  const files = DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  assert.ok(files.length > 50, `only ${files.length} modules were found — the walker has gone stale`);

  const problems = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const seen = new Map(); // binding -> the import line it first came from
    const note = (bind, line) => {
      if (seen.has(bind)) problems.push(`${path.relative(ROOT, file)} — '${bind}' imported twice:\n      ${seen.get(bind)}\n      ${line}`);
      else seen.set(bind, line);
    };
    for (const m of src.matchAll(NAMED)) {
      for (const part of m[1].split(",")) {
        const bit = part.trim();
        if (!bit) continue;
        note(bit.split(/\s+as\s+/).pop().trim(), m[0]);
      }
    }
    for (const m of src.matchAll(DEFAULTISH)) note(m[1], m[0]);
  }
  assert.deepEqual(problems, [], `a module binds one name twice, which fails EVERY test file at load:\n  ${problems.join("\n  ")}`);
});
