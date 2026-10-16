// test/guide-builds.test.js — the PDF builders are PYTHON FILES, and they can be broken by accident.
//
// ⚠️⚠️ WHY THIS EXISTS, AND IT IS NOT HYPOTHETICAL: **three times in one day I added a clause to
// `marketing/build_guide.py` containing a bare `"` inside a double-quoted Python string, and the file stopped
// parsing.**
//
// ⭐ WHAT THAT LOOKS LIKE FROM THE OUTSIDE IS THE WORRYING PART: `python3 build_guide.py` fails, **and the
// guide PDF sitting beside it is simply the OLD one.** Nothing is deleted, nothing looks wrong — ⚠️ **the
// only tell is the page count in a message nobody reads**, and a stale guide is confidently wrong, which the
// guide skill says is worse than a missing one.
//
// ⚠️⚠️ AND `marketing/` IS GITIGNORED, so there is **no version to restore from** when it happens — every fix
// is by hand, on a broken file. ⭐ **A guard that costs six milliseconds is worth a morning of that.**
//
// ⭐ THE HOUSE SPELLING for anyone editing it: copy that quotes her goes in as `__\"…\"__` — the escapes are
// required, because the whole sentence lives inside a Python `"…"`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BUILDERS = ["marketing/build_guide.py", "marketing/build_changelog.py", "marketing/build_intro.py"];
const here = (f) => new URL(`../${f}`, import.meta.url);
const present = (f) => existsSync(here(f).pathname);

// ⚠️ Skip rather than fail when the folder is not here: `marketing/` is gitignored, so a checkout without it
// is a normal checkout. **A guard that goes red because a folder she does not ship is absent is a guard that
// gets ignored, and an ignored guard guards nothing.**
const skip = present(BUILDERS[0]) ? false : "marketing/ is not in this checkout";

function pythonCanParse(file) {
  // ⚠️ `ast.parse` is Python's OWN parser, so this is the same question the builder asks itself — not a
  // second reading of the file by a different tool, which is how two checks come to disagree.
  execFileSync("python3", ["-c", 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())', file], { stdio: "pipe" });
}

test("the PDF builders are still valid Python", { skip }, () => {
  // ⚠️ No Python on this machine is not a fault in the guide — the builders only run when she runs them.
  try { execFileSync("python3", ["-c", "print(1)"], { stdio: "pipe" }); }
  catch { return; }

  for (const f of BUILDERS) {
    if (!present(f)) continue;
    try {
      pythonCanParse(f);
    } catch (e) {
      const said = String((e && e.stderr) || (e && e.message) || "");
      const line = (/line (\d+)/.exec(said) || [])[1];
      assert.fail(`${f} is NOT valid Python${line ? ` (around line ${line})` : ""} — `
        + "⚠️ the builder will not run, and the PDF beside it stays the OLD one, which nothing else here "
        + "reports. ⭐ The usual cause is a bare quote inside a double-quoted Python string: copy that quotes "
        + "her goes in as __\\\"...\\\"__. ⚠️ And `marketing/` is gitignored, so there is no version to "
        + `restore from. ${said.split("\n").slice(-3).join(" ").slice(0, 160)}`);
    }
  }
});

// ⚠️⚠️ AND PARSING IS NOT ENOUGH — THE FILE CAN BE VALID PYTHON AND STILL KILL THE BUILD.
//
// ⭐ MEASURED, and this is the fifth time the guide has broken: I added a clause containing a `⚠` and
// `python3 build_guide.py` died with
//   `FPDFUnicodeEncodingException: Character "⚠" … outside the range of characters supported by the font`
// ⚠️ **`ast.parse` was perfectly happy** — a `⚠` is a legal Python character. ⭐ **So the guard above, which
// asks Python's parser, could not see the one fault that actually happened**, and **the PDF beside it stayed
// the OLD one while nothing reported anything.**
//
// ⭐ SO THIS RUNS THE BUILDER FOR REAL. ⚠️ It is slower than a parse and it writes the PDFs — ⭐ **but that is
// exactly what "the guide is safe to hand her" means, and every cheaper approximation of it has already
// missed a real break.** Skipped when `marketing/` is absent, like the test above.
// ⚠️⚠️ AND EACH BUILDER'S PDF IS PUT BACK EXACTLY AS IT WAS.
//
// ⭐ MEASURED: the same source rebuilt twice gives **different bytes and the same length** — fpdf stamps a
// creation date into the file. ⚠️ **So without this, every run of this test left `changelog.pdf` and the two
// marketing PDFs showing as MODIFIED in GitHub Desktop** — and ⭐ **she commits by ticking boxes, so a file
// that is always ticked is a file she stops reading.** ⭐ **A guard that pollutes the thing it guards is not
// free.** ⚠️ The PDFs are restored whether the build passed or failed, from what was there before.
const OUTPUTS = {
  "marketing/build_guide.py": "marketing/bakester-marketing-guide.pdf",
  "marketing/build_changelog.py": "changelog.pdf",
  "marketing/build_intro.py": "marketing/jienluv2bake-introduction.pdf",
};

test("the PDF builders actually RUN (a valid file can still kill the build)", { skip }, () => {
  try { execFileSync("python3", ["-c", "print(1)"], { stdio: "pipe" }); }
  catch { return; }
  // ⚠️ `fpdf` is what the builders draw with; without it this cannot tell a broken guide from a missing
  // package, and a guard that goes red for the wrong reason is a guard that gets ignored.
  try { execFileSync("python3", ["-c", "import fpdf"], { stdio: "pipe" }); }
  catch { return; }

  for (const f of BUILDERS) {
    if (!present(f)) continue;
    const out = OUTPUTS[f];
    const before = out && existsSync(here(out)) ? readFileSync(here(out)) : null;
    try {
      execFileSync("python3", [new URL(`../${f}`, import.meta.url).pathname], { stdio: "pipe", cwd: new URL("..", here(f)).pathname });
    } catch (e) {
      if (before) writeFileSync(here(out), before);   // ⚠️ restore BEFORE failing the test
      const said = String((e && e.stderr) || (e && e.message) || "");
      assert.fail(`${f} RUNS BUT FAILS — ⚠️ **the PDF beside it is the OLD one, and nothing else reports that.** `
        + "⭐ The usual cause is a character the PDF font cannot print (the builders are latin-1 only): "
        + "`⚠`, `⭐` and emoji all parse as Python and all kill the build. "
        + said.split("\n").slice(-4).join(" ").slice(0, 220));
    } finally {
      // ⚠️ THE FILE GOES BACK EXACTLY AS IT WAS — see OUTPUTS above. ⭐ A rebuild always changes the bytes
      // (a stamped date), so leaving it would mark the PDF modified in GitHub Desktop for ever.
      if (before) writeFileSync(here(out), before);
    }
  }
});
