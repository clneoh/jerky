// test/occasion_catalog.test.js — the curated special-days catalogue behind the
// "Load standard occasions" button (admin/js/occasion_catalog.js): well-formed rows that
// obey the baker's colour rule (public holiday = red, anything else = orange),
// with no accidental duplicates. The catalogue is Malaysia's dates first, then
// the general fun days (pet / baking & sweet / people & kindness), date-sorted.
// The Malaysian rows must keep their shape: state days are gazetted public
// holidays that name who observes them.
//
// The second half covers publishOccasions — which of the baker's own calendar
// marks the customer page is allowed to show. The rule there is a privacy one,
// so it is asserted in its own terms: only a built-in standard day goes out.

import { test } from "node:test";
import assert from "node:assert/strict";

const { OCCASION_CATALOG, importOccColour, publishOccasions } =
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

// ── what the customer page is allowed to see ─────────────────────────────────
// The shop's delivery calendar shows the standard days the baker has marked, and
// nothing else. These tests are the guarantee: her own typed marks (a birthday,
// a promo, a school run) must never leave the app, and an already-passed day is
// never published however it was created.

const mark = (over = {}) => ({
  id: "occ1", label: "Malaysia Day", from: "2026-09-16", to: "2026-09-16",
  colour: "red", ...over,
});

test("a marked standard day is published with its own colour", () => {
  const out = publishOccasions([mark()], "2026-09-14");
  assert.deepEqual(out, [{ label: "Malaysia Day", from: "2026-09-16", to: "2026-09-16", colour: "red" }]);
});

test("a mark the baker typed herself is never published", () => {
  const typed = [
    mark({ id: "occA", label: "Kids' exams", from: "2026-09-21", to: "2026-09-25", colour: "blue" }),
    mark({ id: "occB", label: "Promo week", from: "2026-10-01", to: "2026-10-07", colour: "pink" }),
    mark({ id: "occC", label: "Aunty Bee's birthday", from: "2026-11-02", to: "2026-11-02", colour: "yellow" }),
    mark(), // the one imported standard day, which does go out
  ];
  assert.deepEqual(publishOccasions(typed, "2026-09-14").map((o) => o.label), ["Malaysia Day"]);
});

test("a standard day's name on the wrong date is not published", () => {
  // She renamed a mark, or moved one by hand: the label alone is not enough.
  const moved = mark({ from: "2026-09-17", to: "2026-09-17" });
  assert.deepEqual(publishOccasions([moved], "2026-09-14"), []);
  const renamed = mark({ label: "Merdeka" });
  assert.deepEqual(publishOccasions([renamed], "2026-09-14"), []);
});

test("past marks stay out of the payload, and an odd colour falls back to grey", () => {
  const past = mark({ from: "2026-09-16", to: "2026-09-16" });
  assert.deepEqual(publishOccasions([past], "2026-09-17"), [], "a finished day is dropped");
  const today = publishOccasions([past], "2026-09-16");
  assert.equal(today.length, 1, "a day still running is kept");

  const odd = publishOccasions([mark({ colour: "chartreuse" })], "2026-09-14");
  assert.equal(odd[0].colour, "grey", "an unrecognised colour is not passed through");
  const none = publishOccasions([mark({ colour: undefined })], "2026-09-14");
  assert.equal(none[0].colour, "grey", "a mark with no colour reads grey, as it does in the app");

  // Malformed rows are skipped rather than published half-formed.
  assert.deepEqual(publishOccasions([mark({ to: undefined }), null, {}], "2026-09-14"), []);
  assert.deepEqual(publishOccasions(undefined, "2026-09-14"), [], "no marks, no payload");
});

test("the imported fun days publish too — they are standard days as well", () => {
  const cat = OCCASION_CATALOG.find((e) => e.label === "World Animal Day");
  const out = publishOccasions(
    [{ id: "occ1", label: cat.label, from: cat.from, to: cat.to, colour: importOccColour(cat) }],
    "2026-09-14");
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "World Animal Day");
  assert.equal(out[0].colour, "orange", "not a gazetted holiday, so the orange wash");
});
