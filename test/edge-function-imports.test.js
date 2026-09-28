// test/edge-function-imports.test.js — the Edge Functions are the one family of files
// in this repository that no test can LOAD, so this file reads them instead.
//
// Why they cannot be loaded: the app's own modules are plain ES modules the Node suite
// imports happily (.ts, too, since Node strips types), but a Supabase function starts
// with `import { createClient } from "jsr:@supabase/supabase-js@2"` and is served by
// `Deno.serve`. Node cannot resolve a `jsr:` specifier and has no `Deno`, so the suite
// stops at the first line. Everything behind that line is therefore invisible to every
// other test.
//
// That blind spot has already cost once, and it is the reason this file exists. At v190
// the courier dispatcher was read by hand and its `job` action was found calling
// `orderDetail(cfg, id)` while the import line above it never named `orderDetail`. In
// Deno that is a ReferenceError the moment somebody checks a booked trip; here nothing
// was red, because nothing here had ever looked. A function that calls a name it never
// brought in is the exact class of fault a test that cannot load the file must catch by
// reading it — and it is caught the same way every other rule in this app is: by naming
// it, and by proving the guard can fail.
//
// What this reads for: a CALL — an identifier followed by `(` — whose name the file
// neither imports, nor declares, nor can reach as a language or runtime global. It knows
// nothing about types and deliberately so; a type error belongs to Deno's own checker.
//
// What it cannot see, said plainly rather than implied:
//   • a call through a type argument carrying its own angle brackets, `f<Map<string, number>>(x)`
//     — the shape does not occur in these files, and guessing at it is how a guard starts
//     inventing faults;
//   • a name that is imported and then used for something it is not — this checks that the
//     name ARRIVES, never that the thing behind it is the right one;
//   • a call assembled at runtime, `globalThis[name](…)`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";

const ROOT = new URL("../supabase/functions/", import.meta.url);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const url = new URL(name, dir);
    const at = url.pathname;
    if (statSync(at).isDirectory()) walk(new URL(`${name}/`, dir), out);
    else if (/\.(ts|mjs)$/.test(name)) out.push(url);
  }
  return out;
}

// Everything the language and the Deno runtime hand a file for free. Only names that can
// be CALLED need be here; `class` and `interface` names a file declares are collected below.
const GLOBALS = new Set(`
Deno console fetch Response Request Headers URL URLSearchParams FormData Blob File
JSON Math String Number Boolean Array Object Promise Date Map Set WeakMap WeakSet
Error TypeError RangeError SyntaxError RegExp Symbol Intl BigInt Proxy Reflect
parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent
encodeURI decodeURI setTimeout clearTimeout setInterval clearInterval queueMicrotask
structuredClone TextEncoder TextDecoder AbortController AbortSignal crypto btoa atob
Uint8Array Uint32Array ArrayBuffer DataView
`.trim().split(/\s+/));

// Words that may be followed by `(` without being a call.
const KEYWORDS = new Set(`
if for while switch catch return typeof function await new delete void in of do else
case throw yield import class extends instanceof default try finally break continue
with as from let const var type interface enum implements declare satisfies keyof
async static get set
`.trim().split(/\s+/));

// The source with comments gone and string/template TEXT gone, because a call inside a
// sentence is not a call. A template's `${…}` interior is CODE and is kept — a name called
// only inside one is a name that has to be there.
function codeOnly(src) {
  let out = "";
  const stack = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    const inTemplate = stack[stack.length - 1] === "tmpl";
    if (inTemplate) {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { stack.pop(); out += "``"; i++; continue; }
      if (c === "$" && d === "{") { stack.push("code"); out += " "; i += 2; continue; }
      i++; continue;
    }
    if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    // The quote characters are KEPT and only the text between them is dropped: an import
    // clause is found by looking for the `from "` that follows it, so a scan that ate the
    // quote would stop seeing imports at all — and a guard that sees no imports calls
    // every name in the file unresolved.
    if (c === '"' || c === "'") { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; } out += q + q; i++; continue; }
    if (c === "`") { stack.push("tmpl"); out += "``"; i++; continue; }
    if (c === "}" && stack[stack.length - 1] === "code") { stack.pop(); out += " "; i++; continue; }
    out += c; i++;
  }
  return out;
}

function boundNames(code) {
  const bound = new Set();
  for (const m of code.matchAll(/\bimport\s+([\s\S]*?)\s+from\s*["']/g)) {
    const clause = m[1];
    const named = clause.match(/\{([\s\S]*?)\}/);
    if (named) for (const part of named[1].split(",")) {
      const t = part.trim().replace(/^type\s+/, "");
      if (!t) continue;
      const as = t.split(/\s+as\s+/);
      bound.add((as[1] || as[0]).trim());
    }
    const ns = clause.match(/\*\s+as\s+(\w+)/);
    if (ns) bound.add(ns[1]);
    const before = clause.replace(/\{[\s\S]*?\}/, "").replace(/\*\s+as\s+\w+/, "").trim().replace(/,$/, "").trim();
    if (/^\w+$/.test(before)) bound.add(before);
  }
  for (const m of code.matchAll(/\b(?:async\s+)?function\s*\*?\s*(\w+)/g)) bound.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s+(\w+)/g)) bound.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([\s\S]*?)\}/g))
    for (const part of m[1].split(",")) {
      const t = part.trim().split(":").pop().trim().replace(/^\.\.\./, "");
      if (/^\w+$/.test(t)) bound.add(t);
    }
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\[([\s\S]*?)\]/g))
    for (const part of m[1].split(",")) { const t = part.trim(); if (/^\w+$/.test(t)) bound.add(t); }
  for (const m of code.matchAll(/\b(?:class|type|interface|enum)\s+(\w+)/g)) bound.add(m[1]);
  // A METHOD and a call wear the same shape — `go() {` against `go()`. To a scan with no
  // parser behind it they are the same five characters, so the declaration wins: a class
  // method or an object's own function is found here and goes quiet. The cost is that a
  // missing import could hide behind a method of the same name, which is not a thing that
  // happens, against a guard that fails on every class the day one is written.
  for (const m of code.matchAll(/\b(\w+)\s*\([^()]*\)\s*\{/g)) bound.add(m[1]);
  // Parameters, so a callback handed to `Deno.serve` is not mistaken for somebody's
  // function. A parameter is never CALLED by its own name, so allowing it costs nothing.
  for (const m of code.matchAll(/\(([^()]*)\)\s*(?::[^=>{]*)?=>/g))
    for (const part of m[1].split(",")) {
      const t = part.trim().split(/[:=?]/)[0].trim().replace(/^\.\.\./, "");
      if (/^\w+$/.test(t)) bound.add(t);
    }
  for (const m of code.matchAll(/\bfunction\s*\w*\s*\(([^()]*)\)/g))
    for (const part of m[1].split(",")) {
      const t = part.trim().split(/[:=?]/)[0].trim().replace(/^\.\.\./, "");
      if (/^\w+$/.test(t)) bound.add(t);
    }
  return bound;
}

// A call is an identifier that does not follow a `.` (that is a property on something
// else) and is followed by `(`, past an optional `?.` and optional type arguments.
function unresolvedCalls(source) {
  const code = codeOnly(source);
  const bound = boundNames(code);
  const found = new Map();
  for (const m of code.matchAll(/(^|[^.\w$`"'])([A-Za-z_$][\w$]*)\s*(\??\.)?\s*(<[^<>;{}]*>)?\s*\(/g)) {
    const name = m[2];
    if (KEYWORDS.has(name) || GLOBALS.has(name) || bound.has(name)) continue;
    found.set(name, (found.get(name) || 0) + 1);
  }
  return found;
}

const FILES = walk(ROOT);
const rel = (url) => url.pathname.slice(new URL("../", import.meta.url).pathname.length);

test("the Edge Function sources are found, so a clean scan cannot be an empty one", () => {
  const names = FILES.map(rel);
  // Without this, moving the folder would leave the scan below reporting nothing found
  // and nothing wrong — which reads exactly like a pass.
  assert.ok(names.includes("supabase/functions/courier/index.ts"), `the courier dispatcher is scanned: ${JSON.stringify(names)}`);
  assert.ok(names.includes("supabase/functions/wish-mail/index.ts"), "and so is the other function");
  assert.ok(FILES.length >= 7, `every file in the family is read: ${FILES.length}`);
});

test("every name an Edge Function calls is a name that file actually has", () => {
  const faults = [];
  for (const url of FILES) {
    for (const [name, count] of unresolvedCalls(readFileSync(url, "utf8"))) {
      faults.push(`${rel(url)} calls ${name}() ${count === 1 ? "once" : `${count} times`} without importing or declaring it`);
    }
  }
  assert.deepEqual(faults, [],
    `in Deno this is a ReferenceError on the one press that reaches the line:\n  ${faults.join("\n  ")}`);
});

test("the scan does see a call to a name that was never brought in", () => {
  // The guard above is only worth having if it can fail. This is the v190 fault itself,
  // in miniature: a dispatcher calling a function its import line does not name.
  const src = `
    import { placeOrder } from "./providers/lalamove.ts";
    export async function handle(cfg, args) {
      const job = await orderDetail(cfg, args.orderId);
      return placeOrder(cfg, job);
    }`;
  const found = unresolvedCalls(src);
  assert.deepEqual([...found.keys()], ["orderDetail"], "the missing import is named, and nothing else is");
  assert.equal(found.get("orderDetail"), 1, "and counted once");
});

test("the scan is not fooled by calls that are not calls", () => {
  // Every line below is a thing a scan this simple gets wrong if it is written carelessly.
  // The first two MUST be quiet and the last one MUST be loud, and the loud one is the
  // reason the scanner keeps a template's `${…}` interior instead of dropping the whole
  // string.
  const quiet = `
    import { send } from "./mail.ts";
    const local = () => 1;
    class Thing { go() { return 1; } }
    function use(cfg) {
      local();
      cfg.send();
      if (cfg.ready) local();
      JSON.stringify({ x: 1 });
      const s = "call send(3) in a sentence";
      // send(4) is in a comment
      /* send(5) too */
      const t = \`send(6) is text\`;
      return [local, s, t, Thing];
    }`;
  assert.deepEqual([...unresolvedCalls(quiet).keys()], [], "declared names, property calls, keywords and prose all stay quiet");

  // And the one that is real: a call inside a template's own substitution is code.
  const loud = "import { a } from \"./a.ts\";\nconst s = `total ${charge(1)}`;";
  assert.deepEqual([...unresolvedCalls(loud).keys()], ["charge"], "a call inside ${…} is code, not text");
});
