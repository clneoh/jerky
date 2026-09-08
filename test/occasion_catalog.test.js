// test/occasion_catalog.test.js — the curated special-days catalogue behind the
// "Add occasion" button (admin/js/occasion_catalog.js): well-formed rows that
// obey the baker's colour rule (public holiday = red, anything else = orange),
// with no accidental duplicates. The catalogue is Malaysia's dates first, then
// the general fun days (pet / baking & sweet / people & kindness), date-sorted.
// The Malaysian rows must keep their shape: state days are gazetted public
// holidays that name who observes them.

import { test } from "node:test";
import assert from "node:assert/strict";

const { OCCASION_CATALOG, importOccColour } =
  await import("../admin/js/occasion_catalog.js");
const { OCC_COLOURS } = await import("../admin/js/calendar.js");

const CATS = ["festive", "national", "state", "family", "school", "pet", "bake", "kind"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validISO = (d) => ISO.test(d) && !Number.isNaN(new Date(`${d}T00:00:00`).getTime());

test("the catalogue is a generous list of well-formed, chronological rows", () => {
  assert.ok(OCCASION_CATALOG.length >= 20, "a curated list worth importing");
  let prev = "0000-00-00";
  for (const e of OCCASION_CATALOG) {
    assert.ok(typeof e.label === "string" && e.label.trim(), "every row has a label");
    assert.ok(validISO(e.from), `${e.label} has a real start date`);
    assert.ok(validISO(e.to), `${e.label} has a real end date`);
    assert.ok(e.from <= e.to, `${e.label} ends no earlier than it starts`);
    assert.ok(CATS.includes(e.cat), `${e.label} sits in a known category`);
    assert.equal(typeof e.pub, "boolean", `${e.label} is flagged public or not`);
    assert.ok(e.from >= prev, "rows run oldest → newest");
    prev = e.from;
  }
});

test("importOccColour obeys the rule: public = red, everything else = orange", () => {
  assert.equal(importOccColour({ pub: true }), "red");
  assert.equal(importOccColour({ pub: false }), "orange");
  for (const e of OCCASION_CATALOG) {
    const c = importOccColour(e);
    assert.ok(OCC_COLOURS.includes(c), `${e.label} imports a real colour`);
    assert.equal(c, e.pub ? "red" : "orange", `${e.label} follows the rule`);
  }
});

test("no two rows share the same name on the same start date", () => {
  const seen = new Set();
  for (const e of OCCASION_CATALOG) {
    const key = `${e.label}|${e.from}`;
    assert.ok(!seen.has(key), `"${e.label}" on ${e.from} appears once`);
    seen.add(key);
  }
});

test("every state-specific day is a public holiday and names who observes it", () => {
  const stateRows = OCCASION_CATALOG.filter((e) => e.cat === "state");
  assert.ok(stateRows.length >= 20, "a real union of the Peninsular states' days");
  for (const e of stateRows) {
    assert.equal(e.pub, true, `${e.label} is a gazetted public holiday somewhere`);
    assert.match(e.label, /—\s/, `${e.label} names the state(s) that observe it`);
  }
});

test("the general fun days the baker asked for are present", () => {
  const rows = new Map(OCCASION_CATALOG.map((e) => [`${e.label}|${e.from}`, e]));
  const keys = [
    // pet
    "World Animal Day|2026-10-04",
    "National Pet Day|2027-04-11",
    "International Cat Day|2027-08-08",
    "International Dog Day|2027-08-26",
    "World Animal Day|2027-10-04",
    // bake
    "Cookie Day|2026-12-04",
    "Cookie Day|2027-12-04",
    "World Baking Day|2027-05-17",
    "World Chocolate Day|2027-07-07",
    // kind
    "Random Acts of Kindness Day|2027-02-17",
    "Siblings Day|2027-04-10",
    "Friendship Day|2027-08-01",
  ];
  assert.equal(keys.length, 12, "all twelve fun days checked");
  for (const key of keys) {
    const e = rows.get(key);
    assert.ok(e, `"${key}" is importable`);
    assert.ok(["pet", "bake", "kind"].includes(e.cat), `${key} sits in its own group`);
    assert.equal(e.pub, false, `${key} is not a gazetted public holiday`);
  }
});

test("key dates the baker asked for are present", () => {
  const rows = new Map(OCCASION_CATALOG.map((e) => [`${e.label}|${e.from}`, e]));
  assert.ok(rows.has("Halloween|2026-10-31"), "Halloween 2026 is importable");
  assert.ok(rows.has("Halloween|2027-10-31"), "Halloween 2027 is importable");
  assert.equal(rows.get("Malaysia Day|2026-09-16").pub, true, "Malaysia Day is a public holiday");
  assert.equal(rows.get("Christmas|2027-12-25").pub, true, "Christmas is a public holiday");
  assert.equal(rows.get("Mid-Autumn Festival|2027-09-15").pub, false, "Mid-Autumn is not gazetted");
  assert.equal(rows.get("Year-end school holidays|2026-12-04").to, "2027-01-03");
});
