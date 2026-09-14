// A day the baker marked must look the same everywhere: the customer's calendar
// and the app's own calendar both paint a mark as a see-through wash of its own
// colour, at the same depth for the same length of mark. These pin that — the two
// stylesheets are separate files (the shop must not depend on the app's tree), so
// nothing but a guard stops one of them drifting back to a solid block.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const SHEETS = [["shop", read("store/app.css")], ["app", read("admin/css/app.css")]];
const WASHES = ["--occ-wash: 32%", "--occ-wash: 22%", "--occ-wash: 14%"];

function block(css, selector) {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at !== -1, `${selector} is declared`);
  return css.slice(at, css.indexOf("}", at));
}

test("both calendars mix a mark down by the same three depths", () => {
  for (const [name, css] of SHEETS) {
    for (const w of WASHES) assert.ok(css.includes(w), `${name}: ${w} is missing`);
  }
});

test("a marked day is never a solid block, on either calendar", () => {
  for (const [name, css] of SHEETS) {
    const box = block(css, ".cal-cell.sol::before");
    assert.match(box, /background: color-mix\(/, `${name}: the box is a wash`);
    assert.match(box, /var\(--occ-wash/, `${name}: its depth comes from the shared ladder`);
    assert.ok(!/background: var\(--occ-solid/.test(box),
      `${name}: never the mark's plain solid colour`);
  }
});

test("both calendars hand the box the strength class a band would get", () => {
  for (const [name, file] of [["shop", "store/app.js"], ["app", "admin/js/occgrid.js"]]) {
    assert.ok(read(file).includes("occ-${occStrength(sol)}"),
      `${name}: the box reads its depth from occStrength, like a band`);
  }
});

// A band used to fill its week row instead of being a sheet of one depth, and the
// app's calendars do not all have 34px rows: on the Orders screen a day you deliver
// carries its booking count and is taller, so a holiday's band came out deeper there
// than on every other calendar — and deeper from week to week within one month. The
// baker saw it as the tint sitting off its days. A band is now the same 30px sheet a
// single-day box is, centred.
test("the app's band has one depth, whatever its week row measures", () => {
  const paper = block(read("admin/css/app.css"), ".occ-paper");
  assert.match(paper, /height: 30px/, "app: the band is as deep as a sheet");
  assert.match(paper, /top: 50%/, "app: and centred in its row");
  assert.match(paper, /translateY\(-50%\)/, "app: centred by the transform");
  assert.ok(!/inset:\s*2px/.test(paper), "app: no longer stretched to its row");
});

// The Orders screen has two day shapes in one row — a delivery day (taller, with its
// count) and a plain day. Left at the app's usual 34px the plain one held its number,
// and any mark washed behind it, 6px above the delivery days beside it. One height for
// both, and the `.cal-wrap` hook the rule hangs on is pinned here too: renaming that
// class in orders.js would silently drop the rule, both of them.
//
// One height was only half of it. A delivery day's booking count then sat UNDER the
// number, which pushed that number above the middle of its row while the band (centred
// on the row) stayed put — the baker read that as the tint being off its days on this
// one screen. The count is out of the flow at the foot of the cell now, so every number
// sits on the row's centre line, where the band is.
test("every day on the Orders calendar is one height, with its number on the band's line", () => {
  const css = read("admin/css/app.css");
  assert.match(css, /\.cal-wrap \.cal-cell \{ height: auto; min-height: 52px; \}/,
    "app: every day of the Orders calendar shares one height");
  assert.match(css, /\.cal-cell\.stacked \{[\s\S]*?min-height: 52px/,
    "app: a delivery day is that same height");
  assert.match(css, /\.cal-cell\.stacked \.cal-count \{[^}]*position: absolute;[^}]*bottom: \d+px;/,
    "app: the booking count is pinned to the foot, out of the number's way");
  assert.ok(!/\.cal-cell\.stacked \{[^}]*flex-direction: column/.test(css),
    "app: the count no longer stacks under the number");
  assert.ok(read("admin/js/views/orders.js").includes('class: "cal-wrap"'),
    "orders.js: still wraps its calendar in .cal-wrap, which the rules above need");
});

// The app owns five month calendars and every one of them asks occgrid.js for the
// marks, so Orders cannot quietly drift from Delivery Dates. This is the guard
// against a screen growing its own copy of the class string — the failure mode
// that would put the shop and the app back out of step.
test("the app builds a marked day's classes in exactly one place", () => {
  const CALENDARS = [
    ["Delivery Dates", "admin/js/views/deliveries.js"],
    ["Orders", "admin/js/views/orders.js"],
    ["a product's Availability card", "admin/js/views/products.js"],
    ["the free date fields", "admin/js/datepicker.js"],
  ];
  for (const [name, file] of CALENDARS) {
    assert.ok(!read(file).includes("occ-${occStrength(sol)}"),
      `${name}: asks occgrid.js for the box's classes instead of rebuilding them`);
  }
});
