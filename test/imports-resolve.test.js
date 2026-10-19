// test/imports-resolve.test.js — every name a module imports actually exists (v574).
//
// ⚠️⚠️ WHY THIS EXISTS, AND WHAT IT COST. A commit went out containing **one file from an unfinished next
// version**: `views/settings.js` imported `unreadableCopy` / `dropUnreadableCopy`, and the `state.js` it was
// committed with did not export them yet. ⭐ **A missing named import is a SYNTAX error at load, so the whole
// module graph fails and the app opens BLANK** — on her phone, with nothing on screen to say why.
// ⚠️ And the suite was green the whole time, because no test imports `views/settings.js`.
//
// ⭐ THE LESSON IS NOT "TICK THE FILES MORE CAREFULLY" — it is that **nothing checked that the set of files
// committed could load together.** This does, from the working tree, in a second.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;

function everyModule() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (p.endsWith(".js")) out.push(p);
    }
  };
  // ⚠️ SHIPPED code only: `test/` files RUN under node and fail loudly by themselves, and one of them
  // deliberately writes a probe containing imports that must NOT resolve. The blank-screen risk is here.
  for (const top of ["admin/js", "store"]) {
    const dir = join(ROOT, top);
    if (existsSync(dir)) walk(dir);
  }
  for (const top of readdirSync(ROOT)) {
    if (top.endsWith(".js")) out.push(join(ROOT, top));
  }
  return out;
}

// Every name a relative import asks for. ⚠️ Type-only imports (`type X`) and bare specifiers are skipped —
// this is a check about THIS repo's own files, not about packages.
function namedImports(src) {
  const found = [];
  const re = /import\s*\{([^}]+)\}\s*from\s*["'](\.[^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    // ⚠️ A commented-out import costs nothing and must not fail this — take the line the match sits on.
    const line = src.slice(src.lastIndexOf("\n", m.index) + 1, src.indexOf("\n", m.index));
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    const names = m[1].split(",")
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("type "))
      .map((s) => s.split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    found.push({ names, from: m[2] });
  }
  return found;
}

// ★★★ THE CODE, NOT THE PROSE (v584). ⚠️⚠️ `declares()` matched a name inside a COMMENT — ⚠️ **commenting out
// `export function orderCode` left this file GREEN while the module graph could not link**, which is the very
// blank screen it exists to prevent. ⭐ Comments are removed first: a line that begins a block comment is
// skipped to its close, and a line whose own text starts with `//`, `*` or `/*` is code no more.
function liveSource(src) {
  const out = [];
  let inBlock = false;
  for (const line of String(src || "").split("\n")) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes("*/")) inBlock = false;
      out.push("");
      continue;
    }
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) inBlock = true;
      out.push("");
      continue;
    }
    if (t.startsWith("//") || t.startsWith("*")) { out.push(""); continue; }
    // A trailing block comment on an otherwise real line: drop from `/*` on, unless it closes on the same
    // line (then only the comment goes).
    out.push(line.replace(/\/\*.*?\*\//g, "").replace(/\s\/\/\s.*$/, ""));
  }
  return out.join("\n");
}

function declares(src, name) {
  const code = liveSource(src);
  const esc = name.replace(/[$]/g, "\\$");
  return new RegExp(`export\\s+(?:async\\s+)?(?:function|class|const|let|var)\\s+${esc}\\b`).test(code)
    || new RegExp(`export\\s*\\{[^}]*\\b${esc}\\b`).test(code)
    || new RegExp(`export\\s+\\*\\s+from`).test(code);
}

test("★★★ every named import in this repo resolves to a real export", () => {
  const broken = [];
  for (const file of everyModule()) {
    const src = readFileSync(file, "utf8");
    for (const { names, from } of namedImports(src)) {
      const target = normalize(join(dirname(file), from));
      if (!existsSync(target)) { broken.push(`${file.replace(ROOT, "")} → ${from} (the file does not exist)`); continue; }
      const tsrc = readFileSync(target, "utf8");
      for (const n of names) {
        if (!declares(tsrc, n)) broken.push(`${file.replace(ROOT, "")} → ${from} (no export named ${n})`);
      }
    }
  }
  assert.deepEqual(broken, [],
    "★ a module imports a name that does not exist — **the module graph cannot load, and the app opens BLANK**");
});

test("★★★ and no module declares the same top-level name twice", () => {
  // ⚠️ The other half of the same blank screen: `home.js` carried two `function waDigits` from v565 to v573.
  // ⭐ A duplicate declaration is a SyntaxError in a MODULE — and `node --check` does not say so, because it
  // parses the file as a sloppy script where it is allowed. ⚠️ The homepage's language switch and reviews had
  // not run since.
  const dupes = [];
  for (const file of everyModule()) {
    const lines = liveSource(readFileSync(file, "utf8")).split("\n");
    const seen = new Map();
    lines.forEach((line, i) => {
      const m = /^(?:export\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/
        .exec(line)
        || /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line);
      if (!m) return;
      const name = m[1];
      if (seen.has(name)) dupes.push(`${file.replace(ROOT, "")}:${i + 1} declares ${name} again (first at ${seen.get(name)})`);
      else seen.set(name, i + 1);
    });
  }
  assert.deepEqual(dupes, [],
    "★ a module declares one top-level name twice — **a SyntaxError in a module, and the page it belongs to silently stops working**");
});
