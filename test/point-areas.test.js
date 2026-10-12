// test/point-areas.test.js — the collection AREA tree (v410), as pure arithmetic.
//
// Her words: __"i need something like category for product on POINT. 1st level 2nd level, 3rd
// level....example top level is Penang Island & Prai. Under Penang Island will be Area like Sg Ara,
// Balik Pulau, Farlim, Georgetown"__.
//
// This file judges the MODEL and nothing else — no screen, no publish. Three things are worth
// pinning, and each is a way of being confidently wrong:
//
//   1. NOTHING MOVES ON THE DAY IT ARRIVES. A Point she has never dragged has no `sort`, and an
//      absent sort must rank LAST, not first — `Number(null)` and `Number("")` are both 0, so the
//      naive version would lift every untouched Point above one she had deliberately put on top.
//   2. A POINT IS NEVER LOST BY ITS AREA. Deleting an area, or a hand-edited `areaId` naming
//      something that is not there, must drop the Point into the unfiled block — which is drawn
//      FIRST, because it is a real place a customer can go.
//   3. AN EDIT MUST NOT WIPE WHAT THE FORM DOES NOT ASK ABOUT. `updatePoint` takes a whole draft,
//      so a caller handing over the editor's own fields would otherwise clear her area, her order
//      and the address switch in silence.
//
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  childrenOf, flattenTree, groupPointsByArea, moveArea, movePointInArea, parentOf,
  pathTo, pointChoices, pointCountInArea, pointsInArea, publishPointAreas, shopPointOrder, subtreeIds,
} from "../admin/js/pointAreas.js";
import { activePoints, addPoint, blankPoint, normalizePoint, orderedInArea, publishPoints, updatePoint } from "../admin/js/points.js";

function state(extra = {}) {
  return { orders: [], points: [], pointAreas: [], ...extra };
}

// A tree in her own words: two regions, areas under the island.
const AREAS = [
  { id: "pa_island", name: "Penang Island", parentId: "", sort: 0 },
  { id: "pa_prai", name: "Prai", parentId: "", sort: 1 },
  { id: "pa_sgara", name: "Sg Ara", parentId: "pa_island", sort: 0 },
  { id: "pa_farlim", name: "Farlim", parentId: "pa_island", sort: 1 },
];

// A Point filed into an area, with the fields the real editor would hand over.
function pointInto(st, areaId, name, extra = {}) {
  const p = addPoint(st, {
    name, address: `${name} street`, receiver: "Aunty Lim", phone: "012-345 6789", feeRM: 0.5,
    areaId, ...extra,
  });
  assert.ok(p, `the fixture Point ${name} was created`);
  return p;
}

// ── the tree ────────────────────────────────────────────────────────────────

test("a parent id that is not a string reads as TOP LEVEL, not as a child of nothing", () => {
  assert.equal(parentOf({ parentId: "pa_x" }), "pa_x");
  for (const bad of [null, undefined, {}, { parentId: null }, { parentId: 7 }, 0]) {
    assert.equal(parentOf(bad), "", `parentOf(${JSON.stringify(bad)}) is a root`);
  }
});

test("a parent's children come out in her order, and two that were never dragged come out stably", () => {
  const list = [
    { id: "b", parentId: "", sort: 1 },
    { id: "a", parentId: "", sort: 0 },
    { id: "z", parentId: "b", sort: 0 },
    { id: "c", parentId: "", sort: 1 }, // ties with b — broken on id, so every phone agrees
  ];
  assert.deepEqual(childrenOf(list, "").map((c) => c.id), ["a", "b", "c"]);
  assert.deepEqual(childrenOf(list, "b").map((c) => c.id), ["z"], "a child belongs to its own parent only");
  assert.deepEqual(childrenOf(list, "nope"), [], "a parent nobody points at has no children");
});

test("the walk is depth-first, parents before children, each with its depth and its chain", () => {
  const walk = flattenTree(AREAS);
  assert.deepEqual(walk.map((w) => [w.area.id, w.depth]), [
    ["pa_island", 0], ["pa_sgara", 1], ["pa_farlim", 1], ["pa_prai", 0],
  ], "the island, then its two areas, then Prai — not island, prai, sgara, farlim");
  assert.deepEqual(walk[1].path, ["pa_island"], "a child knows its ancestors");
  assert.deepEqual(walk[0].path, [], "a root has none");
});

test("the walk survives a cycle rather than hanging the app", () => {
  // Only a hand-edited record can do this, and the page must not die over it.
  const cycle = [
    { id: "a", parentId: "b", sort: 0 },
    { id: "b", parentId: "a", sort: 0 },
  ];
  assert.deepEqual(flattenTree(cycle), [], "neither is reachable from the root, so nothing draws");
  // ⚠️ A self-parenting record is UNREACHABLE from the root — it is nobody's child — so it draws
  // nowhere, and the root is all that comes out. The point of the assertion is that the walk
  // TERMINATES and the page does not hang; where an orphan lands is a separate question.
  const half = [{ id: "r", parentId: "", sort: 0 }, { id: "a", parentId: "a", sort: 0 }];
  assert.deepEqual(flattenTree(half).map((w) => w.area.id), ["r"]);
});

test("an area's subtree is itself and everything under it", () => {
  const deep = [...AREAS, { id: "pa_kk", name: "Kampung", parentId: "pa_sgara", sort: 0 }];
  assert.deepEqual([...subtreeIds(deep, "pa_island")].sort(),
    ["pa_farlim", "pa_island", "pa_kk", "pa_sgara"]);
  assert.deepEqual([...subtreeIds(deep, "pa_prai")], ["pa_prai"], "a leaf is its own subtree");
});

test("the chain to an area reads top-down, the area itself last", () => {
  assert.deepEqual(pathTo(AREAS, "pa_sgara").map((c) => c.name), ["Penang Island", "Sg Ara"]);
  assert.deepEqual(pathTo(AREAS, "pa_prai").map((c) => c.name), ["Prai"]);
  assert.deepEqual(pathTo(AREAS, "pa_gone"), [], "an id that is not there has no chain");
});

// ── moving an area ──────────────────────────────────────────────────────────

test("moving an area renumbers only its new brothers", () => {
  const moved = moveArea(AREAS, "pa_farlim", "pa_island", 0);
  assert.deepEqual(childrenOf(moved, "pa_island").map((c) => c.id), ["pa_farlim", "pa_sgara"]);
  assert.deepEqual(childrenOf(moved, "pa_island").map((c) => c.sort), [0, 1]);
  assert.deepEqual(childrenOf(moved, "").map((c) => c.id), ["pa_island", "pa_prai"],
    "and nothing at the top level moved");
});

test("an area can be re-parented, and the group it left is renumbered too", () => {
  const moved = moveArea(AREAS, "pa_farlim", "pa_prai", 0);
  assert.deepEqual(childrenOf(moved, "pa_prai").map((c) => c.id), ["pa_farlim"]);
  assert.deepEqual(childrenOf(moved, "pa_island").map((c) => c.id), ["pa_sgara"]);
  assert.deepEqual(childrenOf(moved, "pa_island").map((c) => c.sort), [0],
    "the old group closes up rather than keeping a gap");
});

test("an area may NOT be dropped inside its own subtree", () => {
  // The drop would orphan the whole branch from the root, so it is refused rather than obeyed.
  const deep = [...AREAS, { id: "pa_kk", name: "Kampung", parentId: "pa_sgara", sort: 0 }];
  assert.equal(moveArea(deep, "pa_island", "pa_sgara", 0), deep, "into a grandchild: refused, same list");
  assert.equal(moveArea(deep, "pa_island", "pa_island", 0), deep, "into itself: refused");
  assert.equal(moveArea(deep, "pa_island", "pa_nowhere", 0), deep, "into an id that is not there: refused");
  assert.deepEqual(childrenOf(deep, "").map((c) => c.id), ["pa_island", "pa_prai"],
    "and the tree is exactly as it was");
});

// ── the order of the Points themselves ──────────────────────────────────────

test("★ a Point she has never dragged keeps the order it arrived in", () => {
  // ⚠️ THE RANK OF AN ABSENT `sort` IS LAST. The naive version — `Number(p.sort) || 0` — reads
  // null and "" as 0, so every untouched Point would rank ABOVE one she had dragged to the top.
  const arrived = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
  assert.deepEqual(orderedInArea(arrived).map((p) => p.id), ["a", "b", "c"],
    "nothing has a sort, so nothing moves");
  const dragged = [
    { id: "a", sort: 1 }, { id: "b", sort: 2 }, { id: "c", sort: 0 },
    { id: "d" }, { id: "e", sort: "" }, { id: "f", sort: null },
  ];
  assert.deepEqual(orderedInArea(dragged).map((p) => p.id), ["c", "a", "b", "d", "e", "f"],
    "her order first, and the ones with no order after it — never lifted above by an empty field");
});

test("moving a Point rewrites the whole order onto the Points, not an index", () => {
  const points = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const moved = movePointInArea(points, "c", 0, ["a", "b", "c"]);
  assert.deepEqual(moved.map((p) => [p.id, p.sort]), [["a", 1], ["b", 2], ["c", 0]]);
  const original = movePointInArea(points, "a", 2, ["a", "b", "c"]);
  assert.deepEqual(original.map((p) => [p.id, p.sort]), [["a", 2], ["b", 0], ["c", 1]]);
});

// ── the one order the screen and the shop both read ─────────────────────────

test("★ the Points no area carries are drawn FIRST, and never lost", () => {
  const st = state({ pointAreas: AREAS });
  pointInto(st, "pa_sgara", "Sg Ara");
  pointInto(st, "pa_prai", "Chai Leng Park");
  const loose = pointInto(st, "", "Somewhere not filed yet");

  const groups = groupPointsByArea(st, st.points);
  assert.equal(groups[0].area, null, "the unfiled block comes first");
  assert.deepEqual(groups[0].points.map((p) => p.name), ["Somewhere not filed yet"]);
  assert.deepEqual(groups.slice(1).map((g) => [g.area.name, g.points.length]),
    [["Penang Island", 0], ["Sg Ara", 1], ["Prai", 1]],
    "⚠️ the island carries nothing itself but is KEPT, because Sg Ara under it does");
  assert.ok(groups.some((g) => g.points.includes(loose)), "and the loose Point is on the page");
});

test("★ a Point whose area has been DELETED falls to the unfiled block rather than vanishing", () => {
  const st = state({ pointAreas: AREAS });
  const p = pointInto(st, "pa_sgara", "Sg Ara");
  st.pointAreas = st.pointAreas.filter((a) => a.id !== "pa_sgara"); // she deleted the area
  const groups = groupPointsByArea(st, st.points);
  assert.deepEqual(groups[0].points.map((x) => x.id), [p.id],
    "it is still on the page, at the top, until she files it somewhere");
  assert.equal(groups.length, 1, "and no heading is left pointing at nothing");
});

test("an area holding nothing is not a group at all", () => {
  const st = state({ pointAreas: AREAS });
  pointInto(st, "pa_prai", "Chai Leng Park");
  const groups = groupPointsByArea(st, st.points);
  assert.deepEqual(groups.map((g) => g.area && g.area.name), ["Prai"],
    "an empty heading would draw a shelf with nothing on it");
});

test("the shop's flat order is the unfiled block, then each area in her order", () => {
  const st = state({ pointAreas: AREAS });
  pointInto(st, "pa_farlim", "Farlim");
  pointInto(st, "", "Loose");
  pointInto(st, "pa_sgara", "Sg Ara");
  pointInto(st, "pa_prai", "Prai shop");
  assert.deepEqual(shopPointOrder(st).map((p) => p.name),
    ["Loose", "Sg Ara", "Farlim", "Prai shop"]);
});

test("grouping takes the Points it is HANDED, so a paused one can be left out", () => {
  // The screen passes every Point — she has to be able to see a paused one. The publish passes
  // only the active ones. One function, so the two can never disagree about the ORDER.
  const st = state({ pointAreas: AREAS });
  const live = pointInto(st, "pa_sgara", "Sg Ara");
  const paused = pointInto(st, "pa_sgara", "Paused one");
  paused.paused = true;
  // ⚠️ Found by AREA, not by position: the unfiled block is the first group and here it is empty,
  // so `[0]` is the island heading and would have answered 0 — a green test of nothing.
  const held = (pts) => groupPointsByArea(st, pts).find((g) => g.area && g.area.id === "pa_sgara").points;
  assert.equal(held(st.points).length, 2, "the screen sees both, paused included");
  assert.deepEqual(held([live]).map((p) => p.id), [live.id],
    "the shop sees only the live one, and the heading is still there");
});

test("how many Points are filed here counts the paused ones too", () => {
  // The number a DELETE refuses over has to answer for everything her record points at.
  const st = state({ pointAreas: AREAS });
  const a = pointInto(st, "pa_sgara", "Sg Ara");
  const b = pointInto(st, "pa_sgara", "Another");
  b.paused = true;
  assert.equal(pointCountInArea(st, "pa_sgara"), 2);
  assert.equal(pointCountInArea(st, "pa_prai"), 0);
  assert.deepEqual(pointsInArea(st, "pa_sgara").map((p) => p.id), [a.id, b.id]);
});

// ── what the customer page is told ──────────────────────────────────────────

test("what the shop is told about the headings: her names, by depth, carrying IDS", () => {
  const st = state({ pointAreas: AREAS });
  // ⚠️ Deliberately NOT named after the area they sit in: a fixture called "Sg Ara" inside an area
  // called "Sg Ara" makes "the Point's name is not on the heading" unfalsifiable — the string is
  // there either way.
  pointInto(st, "pa_sgara", "A shop in the village");
  pointInto(st, "pa_prai", "Chai Leng Park");
  const rows = publishPointAreas(st);
  assert.deepEqual(rows.map((r) => [r.name, r.depth]),
    [["Penang Island", 0], ["Sg Ara", 1], ["Prai", 0]],
    "her areas in her order, with the depth the page indents by");
  assert.deepEqual(Object.keys(rows[0]).sort(), ["depth", "name", "points"]);
  const ids = rows.flatMap((r) => r.points);
  assert.deepEqual(ids, st.points.map((p) => p.id), "IDS, so renamed Points cannot go missing");
  // ⚠️ Names, not ids, would go stale the moment she renames a Point — and the heading must not
  // carry the Point's name at all, because the Point rides its own row with its own line.
  assert.equal(JSON.stringify(rows).includes("A shop in the village"), false,
    "the POINT's name is not on the heading — only the area's own name and the ids of what it holds");
});

test("an area with nothing filed, and a paused Point, never reach the shop as a heading", () => {
  const st = state({ pointAreas: AREAS });
  const p = pointInto(st, "pa_sgara", "Sg Ara");
  assert.deepEqual(publishPointAreas(st).map((r) => r.name), ["Penang Island", "Sg Ara"],
    "the area she filed into — and its parent, so the indent has something to hang from. ⚠️ Prai, which nothing is filed under, is not sent: an empty heading draws a shelf with nothing on it.");
  p.paused = true;
  assert.deepEqual(publishPointAreas(st), [],
    "pause the only Point and no heading is left — the island goes with it");
  assert.deepEqual(publishPointAreas(state()), [], "and with no areas at all the list is empty, not missing");
  assert.ok(Array.isArray(publishPointAreas(state())), "always an array — the payload replaces the key");
});

// ── the two new fields on a Point ───────────────────────────────────────────

test("a new Point is in no area, shows no address, and has NO order until she drags it", () => {
  const b = blankPoint();
  assert.equal(b.areaId, "", "unfiled");
  assert.equal(b.showAddress, false, "⚠️ and off, because no address has ever been published");
  assert.equal("sort" in b, false,
    "⚠️ no sort at all — a 0 here would rank every new Point above one she dragged to the top");
});

test("only a real, non-empty sort is kept; null and '' are not a drag to the top", () => {
  assert.equal("sort" in normalizePoint({ name: "A", sort: null }), false);
  assert.equal("sort" in normalizePoint({ name: "A", sort: "" }), false);
  assert.equal("sort" in normalizePoint({ name: "A", sort: "rubbish" }), false);
  assert.equal(normalizePoint({ name: "A", sort: 0 }).sort, 0, "0 is a real position — the top");
  assert.equal(normalizePoint({ name: "A" }).areaId, "", "an area id that is not a string is no area");
  assert.equal(normalizePoint({ name: "A", areaId: 7 }).areaId, "");
  assert.equal(normalizePoint({ name: "A", showAddress: "yes" }).showAddress, false,
    "half-synced reads as OFF, which is what every Point has always meant");
});

test("★★ an edit that does not mention the area, the order or the switch leaves all three alone", () => {
  // ⚠️ THE TRAP THIS FILE EXISTS FOR. `updatePoint` takes a WHOLE draft, and a caller handing over
  // just the editor's own fields would otherwise clear her area, throw away her order and turn the
  // address switch OFF — which would take an address off her shop without her touching it.
  const st = state({ pointAreas: AREAS });
  const p = pointInto(st, "pa_sgara", "Sg Ara", { showAddress: true });
  const moved = movePointInArea(st.points, p.id, 0, [p.id]);
  st.points = moved;
  assert.equal(st.points[0].sort, 0, "the fixture really has an order");

  const after = updatePoint(st, p.id, { name: "Sg Ara — new name", address: p.address, receiver: p.receiver,
    phone: p.phone, feeRM: p.feeRM });
  assert.equal(after.name, "Sg Ara — new name", "the correction landed");
  assert.equal(after.areaId, "pa_sgara",
    "and the Point keeps its area — an edit is a correction, not a re-filing");
  assert.equal(after.sort, 0, "and its order");
  assert.equal(after.showAddress, true,
    "and the address switch — turning it off by itself would take an address off her shop");

  // ⚠️ AND A CALLER THAT MEANS TO SET ONE STILL CAN.
  const refiled = updatePoint(st, p.id, { name: "Sg Ara", areaId: "pa_prai", showAddress: false });
  assert.equal(refiled.areaId, "pa_prai", "a draft that names the area moves the Point");
  assert.equal(refiled.showAddress, false, "and one that names the switch turns it off");
});

// ── the address switch, at the publisher ────────────────────────────────────

test("★★ the address is published ONLY when she has switched it on, and only when there is one", () => {
  const st = state();
  const hidden = pointInto(st, "", "Hidden", { showAddress: false });
  const shown = pointInto(st, "", "Shown", { showAddress: true });
  const tickedBlank = addPoint(st, { name: "Ticked but blank", address: "", showAddress: true });
  const rows = publishPoints(st);
  const byId = (id) => rows.find((r) => r.id === id);

  assert.equal(byId(hidden.id).address, undefined, "switched off: no address key at all");
  assert.deepEqual(Object.keys(byId(hidden.id)).sort(), ["id", "isKitchen", "minOrderRM", "name"],
    "⚠️ byte-for-byte the row this app has always published — the switch alone changes nothing");
  assert.equal(byId(shown.id).address, "Shown street", "switched on: the address rides the row");
  assert.equal(byId(tickedBlank.id).address, undefined,
    "a tick with nothing typed publishes nothing — there is no address to leak");

  // ⚠️ AND NOTHING ELSE LEAVES WITH IT. The receiver and their phone are what would put a private
  // person's number on a public page.
  const blob = JSON.stringify(rows);
  assert.equal(blob.includes("Aunty Lim"), false, "the receiver is never published");
  assert.equal(blob.includes("60123456789"), false, "nor their phone");
});

// ── v412: her own description of a Point ────────────────────────────────────

test("★★ her own words are published, and nothing is published when she has written none", () => {
  // Her words: __"make the point description custmable in point card"__ — the line a customer reads
  // under the Point's name.
  const st = state();
  const written = pointInto(st, "", "Written", { description: "Aunty Lim's shop, beside the coffee shop" });
  const blank = pointInto(st, "", "Blank", { description: "   " });
  const none = pointInto(st, "", "None");
  const rows = publishPoints(st);
  const by = (id) => rows.find((r) => r.id === id);

  assert.equal(by(written.id).description, "Aunty Lim's shop, beside the coffee shop",
    "her own words are what a customer reads — they ride the published row");
  // ⚠️⚠️ WRITTEN ONLY WHEN THERE IS ONE, the same spelling as the address and the kitchen flag:
  // **a Point she has said nothing about publishes byte-for-byte the row it published yesterday**,
  // and the shop falls back to its own sentence. A whitespace-only box is NO description.
  assert.equal("description" in by(blank.id), false, "a blank box publishes nothing");
  assert.equal("description" in by(none.id), false, "and neither does one she never touched");
  assert.deepEqual(Object.keys(by(none.id)).sort(), ["id", "isKitchen", "minOrderRM", "name"],
    "⚠️ the row an untouched Point publishes is exactly the row this app has always published");
  // Her words are her data — never trimmed into something else, but capped so a paragraph cannot
  // push the places a customer is choosing between off the fold.
  assert.equal(normalizePoint({ name: "A", description: "x".repeat(500) }).description.length, 120);
});

test("★ an edit that does not mention her description does not delete it", () => {
  // ⚠️ THE SAME CARRY TRAP AS THE AREA, THE ORDER AND THE ADDRESS SWITCH — and this one loses HER
  // OWN WORDS, which she would notice on her shop before she noticed them missing from a form.
  const st = state();
  const p = pointInto(st, "", "Sg Ara", { description: "Aunty Lim's shop" });
  const after = updatePoint(st, p.id, { name: "Sg Ara — renamed", address: p.address,
    receiver: p.receiver, phone: p.phone, feeRM: p.feeRM });
  assert.equal(after.name, "Sg Ara — renamed", "the correction landed");
  assert.equal(after.description, "Aunty Lim's shop", "and her own words survived it");
  // And a caller that MEANS to set it still can — including clearing it.
  assert.equal(updatePoint(st, p.id, { name: "Sg Ara", description: "" }).description, "",
    "a draft that names it can empty it");
});

// ── v418: her order reaches the PICKERS, not only the screens ───────────────

test("★★ a Place she dragged is in HER order in the Collect-from picker too", () => {
  // Her words: __"after i reposition with the handle, the drop drop list have to organise is my
  // preference"__. ⚠️⚠️ The Points SCREEN drew her order and the SHOP drew her order, but
  // `activePoints` — **which the Collect-from picker on every order card reads** — still sorted by
  // when each Point was opened. **So the handle moved the list and left every drop-down as it was.**
  const st = state({ pointAreas: AREAS });
  // ⚠️ NO PINS HERE, AND THAT IS THE POINT OF THE FIXTURE (v420). These used to carry one each only
  // because `pointChoices` filtered out every unpinned Point — **the gate that hid her own Places
  // from HER OWN screens.** A fixture that has to work around the thing under test is not a fixture;
  // these are the plain Places she actually makes, and the picker has to take them.
  const a = pointInto(st, "", "First opened", { createdAt: "2026-10-01T00:00:00.000Z" });
  const b = pointInto(st, "", "Second opened", { createdAt: "2026-10-02T00:00:00.000Z" });
  const c = pointInto(st, "", "Third opened", { createdAt: "2026-10-03T00:00:00.000Z" });

  // Their arrival order is the order they were opened in.
  assert.deepEqual(activePoints(st).map((p) => p.name),
    ["First opened", "Second opened", "Third opened"], "nothing has a sort yet, so nothing moves");

  // She drags the LAST one to the top.
  st.points = movePointInArea(st.points, c.id, 0, [a.id, b.id, c.id]);
  assert.deepEqual(activePoints(st).map((p) => p.name),
    ["Third opened", "First opened", "Second opened"], "and the picker follows her hand");
  assert.deepEqual(pointChoices(st).map((c2) => c2.name).slice(1),
    ["Third opened", "First opened", "Second opened"],
    "⚠️ the picker she actually chooses from — the kitchen row sits first, then her order");

  // ⚠️⚠️ AND IT IS **HER GROUPED** ORDER, NOT A FLAT SORT OF THE WHOLE LIST. ⭐ `sort` is PER GROUP,
  // so sorting the flat array just interleaves the groups — a Point dragged to the top of Sg Ara ties
  // with one at the top of Prai, and **neither of them is "first".** ⭐ Her preference is the order the
  // Points SCREEN draws, which is the grouped one, so the picker reads the same function it does.
  const st2 = state({ pointAreas: AREAS });
  const loose = pointInto(st2, "", "Not filed", { createdAt: "2026-10-01T00:00:00.000Z" });
  const prai = pointInto(st2, "pa_prai", "Prai shop", { createdAt: "2026-10-02T00:00:00.000Z" });
  const sgara = pointInto(st2, "pa_sgara", "Sg Ara shop", { createdAt: "2026-10-03T00:00:00.000Z" });
  assert.deepEqual(pointChoices(st2).map((c2) => c2.name).slice(1),
    ["Not filed", "Sg Ara shop", "Prai shop"],
    "⚠️ her areas in her order, each with its Points — the unfiled first, as the screen draws them");
});
