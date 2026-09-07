// test/malaysian_occasions.test.js — the curated Malaysia catalogue behind the
// "Add Malaysia's occasions" button (admin/js/malaysian_occasions.js): well-
// formed rows that obey the baker's colour rule (public holiday = red,
// anything else = orange), with no accidental duplicates.

import { test } from "node:test";
import assert from "node:assert/strict";

const { MALAYSIAN_OCCASIONS, importOccColour } =
  await import("../admin/js/malaysian_occasions.js");
const { OCC_COLOURS } = await import("../admin/js/calendar.js");

const CATS = ["festive", "national", "state", "family", "school"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validISO = (d) => ISO.test(d) && !Number.isNaN(new Date(`${d}T00:00:00`).getTime());

test("the catalogue is a generous list of well-formed, chronological rows", () => {
  assert.ok(MALAYSIAN_OCCASIONS.length >= 20, "a curated list worth importing");
  let prev = "0000-00-00";
  for (const e of MALAYSIAN_OCCASIONS) {
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
  for (const e of MALAYSIAN_OCCASIONS) {
    const c = importOccColour(e);
    assert.ok(OCC_COLOURS.includes(c), `${e.label} imports a real colour`);
    assert.equal(c, e.pub ? "red" : "orange", `${e.label} follows the rule`);
  }
});

test("no two rows share the same name on the same start date", () => {
  const seen = new Set();
  for (const e of MALAYSIAN_OCCASIONS) {
    const key = `${e.label}|${e.from}`;
    assert.ok(!seen.has(key), `"${e.label}" on ${e.from} appears once`);
    seen.add(key);
  }
});

test("every state-specific day is a public holiday and names who observes it", () => {
  const stateRows = MALAYSIAN_OCCASIONS.filter((e) => e.cat === "state");
  assert.ok(stateRows.length >= 20, "a real union of the Peninsular states' days");
  for (const e of stateRows) {
    assert.equal(e.pub, true, `${e.label} is a gazetted public holiday somewhere`);
    assert.match(e.label, /—\s/, `${e.label} names the state(s) that observe it`);
  }
});

test("key dates the baker asked for are present", () => {
  const rows = new Map(MALAYSIAN_OCCASIONS.map((e) => [`${e.label}|${e.from}`, e]));
  assert.ok(rows.has("Halloween|2026-10-31"), "Halloween 2026 is importable");
  assert.ok(rows.has("Halloween|2027-10-31"), "Halloween 2027 is importable");
  assert.equal(rows.get("Malaysia Day|2026-09-16").pub, true, "Malaysia Day is a public holiday");
  assert.equal(rows.get("Christmas|2027-12-25").pub, true, "Christmas is a public holiday");
  assert.equal(rows.get("Mid-Autumn Festival|2027-09-15").pub, false, "Mid-Autumn is not gazetted");
  assert.equal(rows.get("Year-end school holidays|2026-12-04").to, "2027-01-03");
});
