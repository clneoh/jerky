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

test("★★ ONE screen, ONE name — the Kitchen pin is called the same thing everywhere (v402)", () => {
  // Her words: __"instead of send a van, change the term to Location pin for Kitchen"__ — and asked
  // whether the ORDER CARD's "Send a van" should change too, she chose **the screen only**.
  //
  // ⚠️⚠️ THIS SCREEN'S NAME LIVES IN THREE PLACES, and the file it is renamed in is NOT the file that
  // draws the menu. Rename one and not the others and she gets **two names for one screen** — the menu
  // row saying one thing, the title bar another and the page heading a third — with every test still
  // green, because nothing read the three together. That is the same class of fault this whole file
  // exists for: a signpost and its destination only ever read APART.
  const app = readFileSync(join(JS, "app.js"), "utf8");
  const more = readFileSync(join(JS, "views/more.js"), "utf8");
  const view = readFileSync(join(JS, "views", "send_van.js"), "utf8");

  const route = app.match(/"\/send-van":\s*\{\s*title:\s*"([^"]+)"/);
  assert.ok(route, "the /send-van route has gone");
  const row = more.match(/\["#\/send-van",\s*"([^"]+)"/);
  assert.ok(row, "the More row for the Kitchen pin has gone");
  const heading = view.match(/el\("h2",\s*\{\s*class:\s*"section"\s*\},\s*"([^"]+)"\)/);
  assert.ok(heading, "the screen no longer draws a heading of its own");

  const strip = (s) => s.replace(/^[^\p{L}]+/u, "").trim(); // drop the emoji prefix
  const names = [route[1], strip(row[1]), heading[1]];
  assert.deepEqual(new Set(names).size, 1,
    `⚠️ the Kitchen pin screen has ${new Set(names).size} different names: ${JSON.stringify(names)}`);

  // ⚠️ AND THE ADDRESS DOES NOT MOVE WHEN A NAME DOES. `#/send-van` is one she may have bookmarked or
  // arrived at from another screen, and this app has never moved an address for a rename.
  assert.ok(more.includes('"#/send-van"'), "⚠️ the route path was changed along with the name");

  // ⚠️ AND THE ORDER CARDS KEEP THEIR OWN WORD — that is how an order LEAVES, which is a different job.
  const orders = readFileSync(join(JS, "views", "orders.js"), "utf8");
  assert.ok(orders.includes('["Send a van"'), "⚠️ the order card's delivery method was renamed too");
});

// ── v418: her DRAG has to reach the drop-downs, not only the screens ────────
//
// Her words: __"after i reposition with the handle, the drop drop list have to organise is my
// preference, pls check all"__. ⚠️⚠️ **Five screens drag — Ingredients, Products, Categories, Points,
// Areas — and every PICKER fed by one of them listed the raw record array instead.** A drag writes
// `sort` (and `productOrder` inside a heading), never the array, so **the handle moved the shelf and
// left every drop-down as it was.**
//
// ⚠️ THE RULE IS PINNED IN THE SOURCE because two of the three product pickers live inside pop-ups no
// test in this suite can open. ⭐ **And the fault here is not "a helper is wrong", it is "a screen was
// never wired to it"** — which is exactly what a source rule catches and a unit test cannot. (The
// same reasoning `points-publish.test.js` gives for counting publishes rather than trusting that a
// call exists.)
test("★★ every picker that offers a dragged list reads HER order, not the array's", () => {
  const read = (p) => readFileSync(new URL(`../admin/js/${p}`, import.meta.url), "utf8");

  const orders = read("views/orders.js");
  assert.match(orders, /orderedProducts\(state, state\.products\)/,
    "the order card's product picker — the one she reaches for most");

  const products = read("views/products.js");
  assert.match(products, /let ingOpts = tailOrder\(state\.ingredients\.filter/,
    "a product's recipe ingredient picker");

  const po = read("views/po.js");
  assert.match(po, /orderedProducts\(state, \(state\.products/,
    "the manual shopping list's picker");

  // ⚠️ AND THE PLACES — the Collect-from picker on an order card reads `activePoints`, so THAT is
  // where her Point drag has to arrive.
  const points = read("points.js");
  assert.match(points, /return orderedInArea\(pointsOf\(state\)\.map\(kitchenExempt\)/,
    "the Collect-from picker");

  // ⭐ AND THE TWO THAT WERE ALREADY RIGHT, asserted so a later tidy cannot quietly undo them: the
  // areas picker and the category picker both read `flattenTree`, which has always carried `sort`.
  assert.match(read("views/points.js"), /areaPicker\(state,/, "the Point editor's Area box");
  assert.match(read("views/productCategories.js"), /flattenTree\(state\.productCategories\)/,
    "a category's Sits under box");
});

// ★★ AND THE TUG ON A RUN DAY, PINNED FOR THE SAME REASON (v421). The tug lives in a POP-UP, and the
// pop-up is also where a route is MADE — so both facts are wiring, and neither can be driven by a
// test in this suite (this file's own note above, and `delivery-run.test.js`'s shim has no pop-up at
// all). ⚠️ **And the first version of this got it wrong in a way no sheet test could see: the press
// was offered only once a route existed, so from a run day with none there was NO WAY IN.**
test("★★ every doorstep offers the tug, and the tug can MAKE a route (v421)", () => {
  const read = (p) => readFileSync(new URL(`../admin/js/${p}`, import.meta.url), "utf8");

  const run = read("views/delivery_run.js");
  assert.match(run, /\(!isPoint\) \? routeTag\(state, r,/,
    "the doorstep's tug tag is offered on every doorstep row");
  assert.ok(!/\(!isPoint && routeList\.length\)/.test(run),
    "⚠️⚠️ and it is NOT gated on her already having a route — that gate hid the way in behind the "
    + "thing it makes, which is the dead end she reported");

  const routes = read("views/deliveryRoutes.js");
  assert.match(routes, /addRoute\(state, \{ name: nameBox\.value \}\)/,
    "the pop-up really makes the route she names");
  assert.match(routes, /pick\(row\.id\)/,
    "and tugs this doorstep onto it in the same press");
  assert.match(routes, /const routes = routesOf\(state\);\n\s*const nameBox/,
    "⚠️ reading the list as the pop-up is DRAWN, so the name box and the list cannot disagree");
});
