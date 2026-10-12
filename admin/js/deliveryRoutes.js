// deliveryRoutes.js — the VAN routes her Self collection Points are served by (v419), as a pure
// module so the screen that edits them, the Points screen that files a Place onto them, the
// delivery-run screen that groups by them and the tests all read the same rules.
//
// Her words: __"now i need few delivery routes, for one day delivery run day. so point will carry
// its route info..."__ — and, asked whether a Place could be on more than one, __"a point might
// belong to 2 or more routes"__.
//
// ⚠️⚠️ "ROUTE" IS ALREADY A TAKEN WORD IN THIS APP. It names the HASH ROUTER — `admin/js/app.js`
// carries `const routes = {...}` and five test files read that table — so a bare "route" in a
// search would answer two questions at once. This file, the state key, the screen's path and the
// screen's title all say **delivery**: `deliveryRoutes`, `#/delivery-routes`, "Delivery routes".
//
// A route is a FLAT record, not a tree:
//
//   { id, name, sort }
//
// She asked for "a few delivery routes ... No of route configurable", and a route that could
// contain a route would be a second place the same question is answered. `sort` is a STORED NUMBER
// for the same reason the areas' is (see pointAreas.js): a row's POSITION in the array never
// travels between phones, so a list dragged on one phone and read on another would come out in
// whatever order the sync happened to deliver.
//
// ⚠️ A ROUTE IS A SMALL, SMOOTH RUN — her words: __"normally a route is a small stops"__, then
// __"smooth stops"__. It is ONE van's trip round a few neighbouring Places, NOT a region, and it is
// deliberately not the same thing as an AREA: an area is a geography a customer finds himself in
// ("Penang Island › Sg Ara"), a route is the handful of doorsteps one driver does in one go —
// nearby enough that they make a smooth trip. Two Places can be in one area and on two different
// routes, and the two lists are never read as each other. ⚠️ WHICH Places are smooth together is
// HER judgement, made by ticking them on a Point; nothing here measures or suggests a grouping.
//
// ⚠️ A ROUTE CARRIES NO DAYS, AND NO RULES. Her answer to "what should a route's day list do", in
// her words: __"we don control by route, we control by point"__. The days live on the POINT (see
// `point.days`), so there is exactly ONE place a day is ever typed and read. A route is a name and
// a membership, and nothing else.
//
// ⚠️ MEMBERSHIP IS SEVERAL, and it lives on the Point — `point.routeIds`, an ARRAY. This is the one
// place it deliberately differs from `point.areaId`, which is a single id: an area is a geography,
// and *"a place is one place"* — but she told us outright that a Place may be served by more than
// one van. ⚠️ AND THE ORDER OF THAT ARRAY MEANS NOTHING, unlike a product's `categories`, where the
// tick order decides which heading it is listed under. Nothing here reads position.

import { newId } from "./state.js";

// A route's name is a short label on a row, not a sentence.
const NAME_MAX = 40;

const list = (state) => (state && Array.isArray(state.deliveryRoutes) ? state.deliveryRoutes : []);
const txt = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

export function blankRoute() {
  return { id: "", name: "", sort: 0 };
}

// One stored row, cleaned. Anything malformed clamps rather than throwing, so a half-synced or
// hand-edited record can never reach a screen — the same care every other record in this app takes.
export function normalizeRoute(src) {
  const b = blankRoute();
  const s = src && typeof src === "object" ? src : {};
  const sort = Number(s.sort);
  return {
    id: typeof s.id === "string" ? s.id : b.id,
    name: txt(s.name, NAME_MAX),
    sort: Number.isFinite(sort) ? sort : b.sort,
  };
}

// Her routes in her order. Ties break on id, so two records that have never been dragged still
// come out in a stable order on every phone rather than in the order the sync delivered them.
export function routesOf(state) {
  return list(state)
    .filter((r) => r && r.id)
    .map(normalizeRoute)
    .sort((a, b) => a.sort - b.sort || String(a.id).localeCompare(String(b.id)));
}

export function routeById(state, id) {
  const want = String(id || "");
  if (!want) return null;
  return routesOf(state).find((r) => r.id === want) || null;
}

// The name a route is called, or "" — never the id, which is not a word anybody reads.
export function routeName(state, id) {
  const row = routeById(state, id);
  return row ? row.name : "";
}

// ⚠️ THE POINT'S OWN MEMBERSHIP, RESOLVED, IN HER ORDER — and an id naming a route that no longer
// exists is DROPPED HERE rather than left to draw a blank row. A Place must never vanish because a
// route went; it simply stops being on one.
export function routesOfPoint(state, point) {
  const ids = (point && Array.isArray(point.routeIds) ? point.routeIds : []).map(String);
  if (!ids.length) return [];
  const known = routesOf(state).filter((r) => ids.includes(r.id));
  // Keep HER route order, not the order the ids were ticked in — the array order means nothing.
  return known;
}

export function routeNamesOf(state, point) {
  return routesOfPoint(state, point).map((r) => r.name).filter(Boolean);
}

// ⚠️ THE NUMBER A DELETE HAS TO ANSWER FOR. It counts EVERY Point filed on this route, paused
// ones included — a delete has to answer for everything her record points at, not just what a
// customer would see. See `deleteRoute` on the screen.
export function pointsOnRoute(state, id) {
  const want = String(id || "");
  if (!want) return 0;
  return ((state && state.points) || [])
    .filter((p) => p && Array.isArray(p.routeIds) && p.routeIds.map(String).includes(want)).length;
}

// Is this name already taken by another route? The screen refuses on a duplicate, the way the areas
// screen does — two routes with one name is a list she cannot read back.
export function routeNameProblem(state, name, exceptId = "") {
  const want = txt(name, NAME_MAX).toLowerCase();
  if (!want) return "The route needs a name";
  const clash = routesOf(state).some((r) => r.id !== exceptId && r.name.toLowerCase() === want);
  return clash ? `A route called "${txt(name, NAME_MAX)}" already exists` : "";
}

// A new route goes to the END of the list: the order she has already set is hers, and a fresh row
// must not push itself into the middle of it.
//
// ⚠️ `||=` RATHER THAN A BARE `.push`, the same spelling `addPoint` uses: the list is seeded by
// `state.js` and guarded on load, so in the app it is always there — but a state that predates this
// version, or a screen test's own fixture, is not, and `undefined.push` is a dead Add button.
export function addRoute(state, draft) {
  const values = draft && typeof draft === "object" ? draft : {};
  const row = normalizeRoute({ ...values, id: newId("rt"), sort: list(state).length });
  if (!row.name) return null;
  (state.deliveryRoutes ||= []).push(row);
  return row;
}

export function updateRoute(state, id, draft) {
  const rows = list(state);
  const at = rows.findIndex((r) => r && r.id === id);
  if (at < 0) return null;
  const values = draft && typeof draft === "object" ? draft : {};
  // ⚠️ A DRAFT THAT OMITS A KEY MUST NOT WIPE IT — the trap `updatePoint` documents at length. A
  // rename is the common case and it carries only a name, so `sort` is read back from the stored
  // row whenever the draft does not mention it.
  const has = (k) => Object.prototype.hasOwnProperty.call(values, k);
  const next = normalizeRoute({
    ...values,
    id: rows[at].id,
    sort: has("sort") ? values.sort : rows[at].sort,
  });
  if (!next.name) return null;
  rows[at] = next;
  return next;
}

export function deleteRoute(state, id) {
  const want = String(id || "");
  if (!want) return false;
  const before = list(state).length;
  state.deliveryRoutes = list(state).filter((r) => !(r && r.id === want));
  return state.deliveryRoutes.length < before;
}

// Move `id` to sit at `toIndex` and renumber the whole list 0,1,2... Written in FULL rather than as
// one changed index, because a route added or deleted elsewhere must not silently shift the rest.
export function moveRoute(state, id, toIndex) {
  const rows = routesOf(state);
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  const others = rows.filter((r) => r.id !== id);
  const at = Math.max(0, Math.min(Number(toIndex) || 0, others.length));
  const ordered = [...others.slice(0, at), row, ...others.slice(at)];
  const rank = new Map(ordered.map((r, i) => [r.id, i]));
  state.deliveryRoutes = list(state).map((r) => (r && rank.has(r.id) ? { ...r, sort: rank.get(r.id) } : r));
}

// ⚠️ THERE IS NO `forgetRoute` HERE ON PURPOSE, and it is the same answer the areas screen gives:
// a route with Places on it is REFUSED, not quietly unhooked. Taking five Places off a route without
// her asking is a change to her own record — and two controls that look alike must behave alike.
