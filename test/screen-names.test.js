// test/screen-names.test.js — a signpost must name a screen that exists.
//
// Ported from the bakery, whose v337 renamed its day vocabulary from "delivery
// date" to "bake day" and missed three strings that POINTED at the renamed
// screen: an Orders calendar still said "Add it in More → Delivery Dates" while
// the menu row it sent her to had become "Bake days". A signpost that names a row
// nobody can find is a dead end, and nothing noticed, because the message and the
// row were only ever read apart.
//
// THIS APP DID NOT FOLLOW THAT RENAME — jerky's admin still says "delivery date",
// so the specific fault the bakery hit is not here. The GUARD is worth having
// anyway: it is what will catch the next rename, and it derives every name from
// this app's own app.js and more.js, so it says nothing about the bakery's.
//
// So this test reads both: every "More → X" / "More -> X" anywhere in admin/js,
// checked against the names that really exist — the route titles, the More menu
// rows, and the group headings those rows sit under.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const JS = join(ROOT, "admin/js");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

// The names a signpost is allowed to use.
function destinations() {
  const names = new Set();

  const app = readFileSync(join(JS, "app.js"), "utf8");
  for (const m of app.matchAll(/title:\s*"([^"]+)"/g)) names.add(m[1]);

  // More's rows and the headings they sit under: ["#/href", "Label", "hint"].
  const more = readFileSync(join(JS, "views/more.js"), "utf8");
  for (const m of more.matchAll(/\["#[^"]*",\s*"([^"]+)"/g)) {
    names.add(m[1].replace(/^[^\p{L}]+/u, ""));   // drop the emoji prefix
  }
  // The group headings: ["Logistic", [ …rows… ]] and menuGroup(["Settings & this app", …
  for (const m of more.matchAll(/\["([^"#][^"]*)",\s*\[/g)) names.add(m[1]);
  for (const m of more.matchAll(/menuGroup\(\["([^"]+)"/g)) names.add(m[1]);

  return [...names].filter(Boolean);
}

// "More → Bake days." captured as "Bake days." — keep only the leading phrase,
// because the sentence goes on to explain itself ("Bake days screen already uses…").
function phraseAfter(text) {
  return text.split(/[.,;:!?—()]/)[0].trim();
}

test("every 'More → X' signpost names a screen that exists", () => {
  const names = destinations();
  assert.ok(names.length > 15, `expected the app's whole screen list, got ${names.length}`);
  assert.ok(names.includes("Delivery Dates"), "the day screen is among them");

  const lower = names.map((n) => n.toLowerCase());
  const bad = [];

  for (const file of walk(JS)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/More\s*(?:→|->)\s*([^\n"]+)/g)) {
      const said = phraseAfter(m[1]);
      if (!said) continue;
      const starts = lower.some((n) => {
        const s = said.toLowerCase();
        return s === n || s.startsWith(n + " ");
      });
      if (!starts) bad.push(`${file.slice(ROOT.length)}  →  "${said}"`);
    }
  }

  assert.deepEqual(bad, [],
    "a signpost sends her to a screen name the app does not have");
});
