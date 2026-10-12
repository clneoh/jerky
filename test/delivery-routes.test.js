// test/delivery-routes.test.js — the VAN routes a Place is served by, and the days a Place is
// served (v419), as pure arithmetic.
//
// Her words: __"now i need few delivery routes, for one day delivery run day. so point will carry
// its route info, and day of the week choices, day of the week can be any day, up to 7 days,
// configurable. No of route configurable"__ — and, asked twice, __"a point might belong to 2 or
// more routes"__ and __"say one point that is on 2 or 3 routes, that it get more day probably"__.
//
// This file judges the MODEL and nothing else — no screen, no run, no shop. Four things are worth
// pinning, and each is a way of being confidently wrong:
//
//   1. AN EDIT MUST NOT WIPE WHAT THE FORM DOES NOT ASK ABOUT. `updatePoint` takes a whole draft, so
//      a caller handing over the editor's own fields would otherwise put the Place on NO route and
//      open it EVERY day of the week — in silence, without her touching either.
//   2. NOTHING MOVES ON THE DAY IT ARRIVES. A Place she has not touched is served every bake day
//      and is on no route, and neither may change what the shop publishes: `days` is written only
//      when she has actually restricted it.
//   3. A PLACE IS NEVER LOST BY A ROUTE. An id naming a route that has since been deleted is simply
//      dropped on the way out — a Place on two routes must not break because one of them went.
//   4. THE TICK ORDER IS NOT A RANK. Two routes on one Place is a membership, not a preference —
//      unlike a product's `categories`, where the first tick decides the heading it is listed under.
//
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addRoute, blankRoute, moveRoute, normalizeRoute, pointsOnRoute, routeById, routeName,
  routeNameProblem, routesOf, routesOfPoint, updateRoute, deleteRoute,
} from "../admin/js/deliveryRoutes.js";
import {
  addPoint, normalizePoint, pointDays, publishPoints, servedEveryDay, updatePoint,
} from "../admin/js/points.js";

// ⚠️ THE ROUTES ARE CLONED, and that is not tidiness. `addRoute` pushes into `state.deliveryRoutes`
// and `updateRoute` writes a row straight back into it, so a fixture array handed in by reference
// would be MUTATED by the first test that ran and every test after it would silently be reading a
// different list. ⚠️ THE CLONE IS TAKEN **AFTER** THE SPREAD for exactly that reason: a test that
// passes `deliveryRoutes: ROUTES` itself would otherwise override the cloned default and share the
// module constant again — which is precisely what the first version of this helper did.
function state(extra = {}) {
  const st = { orders: [], points: [], deliveryRoutes: [], ...extra };
  st.deliveryRoutes = (st.deliveryRoutes || []).map((r) => ({ ...r }));
  return st;
}

const ROUTES = [
  { id: "rt_a", name: "Route A", sort: 0 },
  { id: "rt_b", name: "Route B", sort: 1 },
];

// A Place on the routes named, with the fields the real editor would hand over.
function pointOn(st, routeIds, name, extra = {}) {
  const p = addPoint(st, {
    name, address: `${name} street`, receiver: "Aunty Lim", phone: "012-345 6789", feeRM: 0.5,
    routeIds, ...extra,
  });
  assert.ok(p, `the fixture Place ${name} was created`);
  return p;
}

// ── the list ────────────────────────────────────────────────────────────────

test("a new route is named, given its own id, and goes to the END of her order", () => {
  const st = state({ deliveryRoutes: ROUTES });
  const r = addRoute(st, { name: "Route C" });
  assert.ok(r && r.id.startsWith("rt_"), "a route is given its own id");
  assert.equal(r.name, "Route C");
  assert.equal(r.sort, 2, "⚠️ appended, never pushed into the middle of the order she has set");
  assert.equal(st.deliveryRoutes.length, 3);
  assert.deepEqual(routesOf(st).map((x) => x.name), ["Route A", "Route B", "Route C"]);
});

test("routesOf reads her order, and two routes that never had a sort still come out stable", () => {
  const st = state({ deliveryRoutes: [
    { id: "rt_z", name: "Zed", sort: 1 },
    { id: "rt_a", name: "Aye", sort: 0 },
    { id: "rt_m", name: "Emm" }, // no sort at all — an older record, or one hand-edited
  ] });
  assert.deepEqual(routesOf(st).map((x) => x.name), ["Aye", "Emm", "Zed"],
    "⚠️ an ABSENT sort reads as 0 here, unlike a Point's — a route list has no hand-placed order to "
    + "protect, so a record with none simply ties with the head and the tie breaks on id, which is "
    + "stable on every phone rather than in whatever order the sync delivered them");
  assert.equal(routeName(st, "rt_z"), "Zed");
  assert.equal(routeById(st, "rt_nope"), null, "an id that names nothing answers null, not a blank row");
});

test("a route's name is trimmed and capped, and a bad sort is not allowed through", () => {
  assert.equal(normalizeRoute({ name: "  Route A  " }).name, "Route A");
  assert.equal(normalizeRoute({ name: "x".repeat(80) }).name.length, 40, "a name is a label, not a sentence");
  assert.equal(normalizeRoute({ name: "A", sort: "3" }).sort, 3);
  assert.equal(normalizeRoute({ name: "A", sort: "nonsense" }).sort, 0);
  assert.equal(blankRoute().name, "", "a blank route has no name");
});

test("a blank name and a duplicate name are both refused, and its own name is not a clash", () => {
  const st = state({ deliveryRoutes: ROUTES });
  assert.ok(routeNameProblem(st, ""), "a route needs a name");
  assert.ok(routeNameProblem(st, "   "), "whitespace is not a name either");
  assert.ok(routeNameProblem(st, "route a"), "⚠️ case-insensitively — 'route a' is 'Route A' to a reader");
  assert.equal(routeNameProblem(st, "Route A", "rt_a"), "",
    "the route's own name is not a clash with itself when she is editing it");
  assert.equal(routeNameProblem(st, "Route C"), "", "a fresh name is fine");
});

// ── nothing of hers is rewritten ────────────────────────────────────────────

test("★★ a rename keeps the place in her order", () => {
  // ⚠️ THE TRAP THIS FILE EXISTS FOR, in its smallest form. The edit pop-up hands over a draft with
  // a NAME on it and nothing else, so a version that let the draft define `sort` would drop the
  // route to the top of her list the moment she corrected a spelling.
  const st = state({ deliveryRoutes: ROUTES });
  const after = updateRoute(st, "rt_b", { name: "Route B — Prai" });
  assert.equal(after.name, "Route B — Prai", "the correction landed");
  assert.equal(after.sort, 1, "⚠️ and the route is still second");
  assert.deepEqual(routesOf(st).map((x) => x.name), ["Route A", "Route B — Prai"]);

  // ⚠️ AND A CALLER THAT MEANS TO MOVE IT STILL CAN.
  assert.equal(updateRoute(st, "rt_b", { name: "Route B — Prai", sort: 0 }).sort, 0);
});

test("★★ an edit that does not mention the routes or the days leaves BOTH alone", () => {
  // ⚠️⚠️ THE SAME TRAP ON THE POINT, and it lands harder: a Place that loses its routes stops being
  // on any van's run, and one that loses its days quietly opens every day of the week — neither of
  // which she asked for, and both invisible on the card unless she goes looking.
  const st = state({ deliveryRoutes: ROUTES });
  const p = pointOn(st, ["rt_a", "rt_b"], "Sg Ara", { days: [5] });
  assert.deepEqual(p.routeIds, ["rt_a", "rt_b"], "the fixture really is on two routes");
  assert.deepEqual(p.days, [5], "and really is Friday-only");

  const after = updatePoint(st, p.id, { name: "Sg Ara — new name", address: p.address,
    receiver: p.receiver, phone: p.phone, feeRM: p.feeRM });
  assert.equal(after.name, "Sg Ara — new name", "the correction landed");
  assert.deepEqual(after.routeIds, ["rt_a", "rt_b"], "and the Place is still on both routes");
  assert.deepEqual(after.days, [5], "and still served on Friday only");

  // ⚠️ AND A CALLER THAT MEANS TO SET THEM STILL CAN.
  const reworked = updatePoint(st, p.id, { name: "Sg Ara", routeIds: ["rt_b"], days: [] });
  assert.deepEqual(reworked.routeIds, ["rt_b"], "a draft that names the routes re-files the Place");
  assert.deepEqual(reworked.days, [], "and one that names the days opens it up again");
});

// ── moving a route ──────────────────────────────────────────────────────────

test("a drag renumbers the whole list, and writes it onto the records", () => {
  const st = state({ deliveryRoutes: ROUTES.concat([{ id: "rt_c", name: "Route C", sort: 2 }]) });
  moveRoute(st, "rt_c", 0);
  assert.deepEqual(routesOf(st).map((x) => x.name), ["Route C", "Route A", "Route B"],
    "⚠️ written in FULL rather than as one changed index, so a route added or deleted elsewhere "
    + "cannot silently shift the rest");
  // ⚠️ READ THE `sort` VALUES, NOT THE ARRAY POSITIONS. The array is deliberately NOT kept in
  // display order — `routesOf` sorts on read, and a stored position is exactly what this app refuses
  // to depend on, because it does not travel between phones.
  const sortOf = (id) => st.deliveryRoutes.find((r) => r.id === id).sort;
  assert.equal(sortOf("rt_c"), 0, "and renumbered 0,1,2");
  assert.equal(sortOf("rt_a"), 1);
  assert.equal(sortOf("rt_b"), 2);
});

// ── a Place is never lost by a route ────────────────────────────────────────

test("★★ a Place's routes read in HER order, and an id naming a deleted route is dropped", () => {
  const st = state({ deliveryRoutes: ROUTES });
  // ⚠️ Ticked in the order B, A, and reading back as A, B — the array order is a membership, not a
  // rank, so nothing here may let the tick order decide what the screen draws first.
  const p = pointOn(st, ["rt_b", "rt_a", "rt_gone"], "Farlim");
  assert.deepEqual(routesOfPoint(st, p).map((r) => r.id), ["rt_a", "rt_b"],
    "her route order, with the id of a route that no longer exists dropped rather than drawn blank");
  assert.deepEqual(routesOfPoint(st, p).map((r) => r.name), ["Route A", "Route B"]);
  assert.deepEqual(routesOfPoint(state(), pointOn(state(), [], "Nowhere")), [],
    "a Place on no route reads as an empty list, never null");
});

// ── the count a delete answers for ──────────────────────────────────────────

test("pointsOnRoute counts every Place filed, paused ones included", () => {
  const st = state({ deliveryRoutes: ROUTES });
  pointOn(st, ["rt_a"], "Sg Ara");
  pointOn(st, ["rt_a"], "Farlim", { paused: true });
  pointOn(st, ["rt_b"], "Chai Leng Park");
  assert.equal(pointsOnRoute(st, "rt_a"), 2,
    "⚠️ a PAUSED Place still counts: she has to answer for everything her record points at, not "
    + "just what a customer would see — the same rule `pointCountInArea` keeps");
  assert.equal(pointsOnRoute(st, "rt_b"), 1);
  assert.equal(pointsOnRoute(st, "rt_gone"), 0);
  assert.equal(pointsOnRoute(st, ""), 0, "no id is nobody's route");
});

test("a route with nothing on it can be deleted, and only that one goes", () => {
  const st = state({ deliveryRoutes: ROUTES });
  pointOn(st, ["rt_a"], "Sg Ara");
  assert.equal(deleteRoute(st, "rt_b"), true);
  assert.deepEqual(routesOf(st).map((x) => x.name), ["Route A"], "the empty one went");
  assert.equal(deleteRoute(st, "rt_nope"), false, "deleting something that is not there is not a delete");
});

// ── the days ────────────────────────────────────────────────────────────────

test("★★ nothing moves on the day it arrives: a new Place is on no route and served EVERY day", () => {
  const st = state();
  const p = addPoint(st, { name: "Farlim", address: "Lebuhraya Thean Teik",
    receiver: "Aunty Lim", phone: "012-345 6789", feeRM: 0.5 });
  assert.deepEqual(p.routeIds, [], "on no route");
  assert.deepEqual(p.days, [], "and no days — which MEANS every bake day, not 'not set yet'");
  assert.equal(servedEveryDay(p), true, "so the card can say so rather than showing an empty box");
});

test("★★ EMPTY and ALL SEVEN are the same answer — 'every day' and 'no limit' are one thing", () => {
  assert.equal(servedEveryDay({ days: [] }), true, "nothing ticked");
  assert.equal(servedEveryDay({ days: [0, 1, 2, 3, 4, 5, 6] }), true, "all seven ticked");
  assert.equal(servedEveryDay({ days: [5] }), false, "⚠️ Friday only is a real restriction");
  assert.equal(servedEveryDay({ days: [1, 3, 5] }), false);
});

test("a day is a whole number 0-6, deduped and sorted — anything else is DROPPED, not clamped", () => {
  assert.deepEqual(normalizePoint({ name: "A", days: [5] }).days, [5]);
  assert.deepEqual(normalizePoint({ name: "A", days: [5, 1, 5, 3] }).days, [1, 3, 5],
    "⚠️ deduped and sorted, so one week is spelled one way whichever screen wrote it");
  assert.deepEqual(normalizePoint({ name: "A", days: [7, -1, 3.5, "x", null] }).days, [],
    "⚠️ DROPPED, not clamped to a day she never chose — the care `validWindow` takes with a window");
  assert.deepEqual(normalizePoint({ name: "A", days: "Friday" }).days, [], "a string is not a list of days");
  assert.deepEqual(pointDays({ days: [5, 1] }), [1, 5], "the reader cleans on the way out too");
});

test("a route id that is not a string is dropped, and a repeat is kept once", () => {
  assert.deepEqual(normalizePoint({ name: "A", routeIds: ["rt_a", "rt_a", "", "  ", 7, null] }).routeIds,
    ["rt_a"]);
  assert.deepEqual(normalizePoint({ name: "A", routeIds: "rt_a" }).routeIds, [],
    "⚠️ a bare string is NOT a list of one — a half-synced record reads as no route, not as a guess");
});

// ── at the publisher ────────────────────────────────────────────────────────

test("★★ the days are published ONLY when she has restricted them", () => {
  const st = state();
  const open = pointOn(st, [], "Always open");
  const allSeven = pointOn(st, [], "Every day ticked", { days: [0, 1, 2, 3, 4, 5, 6] });
  const friday = pointOn(st, [], "Fridays only", { days: [5] });
  const rows = publishPoints(st);
  const byId = (id) => rows.find((r) => r.id === id);

  assert.equal(byId(open.id).days, undefined, "no restriction: no days key at all");
  assert.deepEqual(Object.keys(byId(open.id)).sort(), ["id", "isKitchen", "minOrderRM", "name"],
    "⚠️⚠️ byte-for-byte the row this app has always published — so a Place she never touched "
    + "cannot change her shop page by this version arriving");
  assert.equal(byId(allSeven.id).days, undefined,
    "⚠️ and all seven is the SAME answer as none — publishing 'every day' would be a line that says nothing");
  assert.deepEqual(byId(friday.id).days, [5], "a real restriction rides the row");

  // ⚠️⚠️ AND HER VANS NEVER LEAVE. A route is her own working arrangement; a customer has no
  // business knowing which van carries his bread, and the shop draws no route line at all.
  for (const row of rows) {
    assert.equal(row.routeIds, undefined, "routes are never published");
  }
});
