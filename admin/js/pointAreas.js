// pointAreas.js — the tree that GROUPS Self collection Points, as a pure module so the
// screen that edits it, the Points screen that files a Point into it, the publish to the
// customer page and the tests all read the same rules.
//
// Her words: __"i need something like category for product on POINT. 1st level 2nd level,
// 3rd level....example top level is Penang Island & Prai. Under Penang Island will be Area
// like Sg Ara, Balik Pulau, Farlim, Georgetown"__.
//
// ⭐ IT IS THE SAME SHAPE AS THE PRODUCT CATEGORY TREE (see productCategories.js) AND THAT IS
// DELIBERATE RATHER THAN CONVENIENT: she pointed at it. An area is a FLAT record carrying its
// parent's id, not a node with a children array:
//
//   { id, name, parentId: "" | <areaId>, sort: 0 }
//
// Flat, because the cloud sync carries whole records keyed by id (sync.js computeRecords): a
// nested tree has no per-node id, so one edit anywhere would rewrite one giant record and two
// phones editing different branches would clobber each other. `parentId` also means any depth
// falls out for free — Penang Island › Sg Ara › ... is just records pointing at each other.
//
// ORDER IS A STORED NUMBER, for the same reason: a row's POSITION in state.pointAreas never
// travels between phones. `sort` is renumbered 0..n-1 across a parent's children on every drop.
//
// ⚠️ AN AREA IS NOT A PLACE. "Penang Island" has no address, no receiver, no fee, no pin, no
// collection window and no smallest basket, and a customer must never be offered it as somewhere
// to collect. So it is its OWN LIST, not a flag on a Point — modelling a heading as a Point
// would drag every Point rule (the fee, the kitchen exemption, Pause, the pin gate) onto a word.
//
// ⚠️ MEMBERSHIP IS ONE PARENT, on the Point: `point.areaId`. A single id, not an array like a
// product's `categories` — **a place is one place**, and unlike a product, which is deliberately
// allowed to sit under several headings, a shop front cannot be in two villages.
//
// ⚠️ AND THE ORDER OF THE POINTS THEMSELVES LIVES ON THE POINT (`point.sort`), not in a
// `pointOrder` array on the area the way a category holds `productOrder`. A product can be filed
// under several headings, so its order has to be stored per heading; a Point is in exactly one
// group, **including the unfiled group (`areaId: ""`)** — so one field on the Point covers both
// and there is only ever one mechanism to keep right.

import { activePoints, kitchenPoint, orderedInArea } from "./points.js";

const byId = (list, id) => (list || []).find((c) => c && c.id === id) || null;

// An area's parent as an id, with "" meaning a top-level area. Written through one helper so a
// missing parentId never reaches a comparison as undefined (which would quietly make a root look
// like a child of nothing).
export function parentOf(area) {
  return area && typeof area.parentId === "string" ? area.parentId : "";
}

// The children of one parent, in her order. Ties break on id so two records that have never been
// dragged still come out in a stable order on every phone rather than in the order the sync
// happened to deliver them in.
export function childrenOf(list, parentId = "") {
  const want = typeof parentId === "string" ? parentId : "";
  return (list || [])
    .filter((c) => c && c.id && parentOf(c) === want)
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.id).localeCompare(String(b.id)));
}

// Depth-first walk of the whole tree: every area once, parents before their children, siblings in
// order, each with its depth and the ids of its ancestors. This is the single ordering the screen
// and the shop both read, so they can never disagree about what "her order" means.
export function flattenTree(list) {
  const out = [];
  const walk = (parentId, depth, path) => {
    for (const c of childrenOf(list, parentId)) {
      out.push({ area: c, depth, path });
      // A cycle can only exist if records were hand-edited; stopping at a depth no real list
      // reaches keeps the walk finite instead of hanging the tab.
      if (depth < 32) walk(c.id, depth + 1, [...path, c.id]);
    }
  };
  walk("", 0, []);
  return out;
}

// Every area under `id`, plus the id itself — what an area may not be re-parented into (its own
// subtree). Breadth-first over parent links rather than the ordered walk, so a cycle among the
// records cannot send this into an endless loop.
export function subtreeIds(list, id) {
  const seen = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of list || []) {
      if (!c || !c.id || seen.has(c.id)) continue;
      if (seen.has(parentOf(c))) { seen.add(c.id); grew = true; }
    }
  }
  return seen;
}

// The chain from the top down to `id`, the area itself last — the words a heading reads when it
// is nested ("Penang Island › Sg Ara").
export function pathTo(list, id) {
  const chain = [];
  const seen = new Set();
  let cur = byId(list, id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = byId(list, parentOf(cur));
  }
  return chain;
}

// Move `id` to sit among `parentId`'s children at `toIndex`, and renumber that group's `sort`
// 0,1,2... An area may not be dropped inside its own subtree (the drop would orphan the branch
// from the root); that is refused by handing the list back untouched, so a bad drop is a no-op
// rather than corruption.
export function moveArea(list, id, parentId, toIndex) {
  const area = byId(list, id);
  if (!area) return list;
  const parent = typeof parentId === "string" ? parentId : "";
  if (parent && !byId(list, parent)) return list;
  if (parent === id || subtreeIds(list, id).has(parent)) return list;

  const others = childrenOf(list, parent).filter((c) => c.id !== id);
  const at = Math.max(0, Math.min(Number(toIndex) || 0, others.length));
  const ordered = [...others.slice(0, at), area, ...others.slice(at)];

  const moved = new Map(ordered.map((c, i) => [c.id, i]));
  return (list || []).map((c) => {
    if (!c || !c.id) return c;
    if (c.id === id) return { ...c, parentId: parent, sort: moved.get(id) };
    if (moved.has(c.id)) return { ...c, sort: moved.get(c.id) };
    return c;
  });
}

// Move one Point to `toIndex` among `currentIds`, writing the whole order onto the Points
// themselves. Written in FULL rather than as an index, because a Point added, filed or deleted
// elsewhere must not silently shift every other row.
export function movePointInArea(points, id, toIndex, currentIds) {
  const ordered = (currentIds || []).filter((pid) => pid !== id);
  const at = Math.max(0, Math.min(Number(toIndex) || 0, ordered.length));
  ordered.splice(at, 0, id);
  const rank = new Map(ordered.map((pid, i) => [pid, i]));
  return (points || []).map((p) => (p && rank.has(p.id) ? { ...p, sort: rank.get(p.id) } : p));
}

// The Points filed in one area, in the order she set. A Point whose `areaId` names an area that
// no longer exists is NOT returned here — it belongs to no area, and the grouping below is what
// catches it rather than letting it vanish.
export function pointsInArea(state, areaId) {
  const want = String(areaId || "");
  return orderedInArea((state && state.points) || []).filter((p) => p && (p.areaId || "") === want);
}

// How many Points are filed here, in any state — the number a delete refuses over. It counts
// PAUSED Points too, because a delete has to answer for everything her record points at, not just
// what a customer would see.
export function pointCountInArea(state, areaId) {
  const want = String(areaId || "");
  return ((state && state.points) || [])
    .filter((p) => p && (p.areaId || "") === want).length;
}

// ── The one order the screen and the shop both read ─────────────────────────
//
// Her areas in her order, depth-first, each carrying the Points filed under it — and, FIRST, the
// Points no area carries, as a block with `area: null`.
//
// It takes the POINTS rather than reading state.points, because the caller has already chosen
// them (productCategories.js's `groupByCategory` takes its products for the same reason): the
// Points screen passes every Point, including paused ones it still has to show her, and the
// publish passes `activePoints` — the ones a customer may actually be offered.
//
// ⚠️⚠️ THE UNFILED BLOCK COMES FIRST, NOT LAST, and that is the one place this deliberately
// differs from the product menu. On a menu, a product filed under no heading is a leftover and
// "More items" belongs at the end. **A Point is not a leftover — it is a real place a customer
// can go**, and burying a collectable place below her headings helps nobody. It is also where a
// Point lands when its area is deleted, so it has to stay in plain sight until she files it.
//
// An area holding no Point IN THIS LIST is left out, so the shop never draws an empty heading.
export function groupPointsByArea(state, points) {
  const list = Array.isArray(points) ? points : [];
  const areas = state && state.pointAreas;
  const out = [];
  const loose = orderedInArea(list.filter((p) => p && !byId(areas, p.areaId || "")));
  if (loose.length) out.push({ area: null, depth: 0, points: loose });

  // ⚠️⚠️ A HEADING IS KEPT WHEN ANYTHING UNDER IT SURVIVES, even though it carries no Point of its
  // own. Without this, filing a Point into **Sg Ara** drew **only** "Sg Ara" — indented one step
  // with **no "Penang Island" above it**, a child hanging in space whose indent meant nothing and
  // whose parent she could not see. The shop's menu has kept a parent heading for its surviving
  // descendants since its categories went in (store/app.js), and this is the same rule for the
  // same reason: **an indent with nothing to be indented from is not a tree, it is a typo.**
  const carries = new Set(list.map((p) => p && (p.areaId || "")).filter((id) => !!byId(areas, id)));
  const survives = new Set(carries);
  for (const id of carries) {
    let cur = byId(areas, id);
    let guard = 0;
    // ⚠️ Guarded, because a hand-edited record can point a parent at its own descendant and this
    // walks UPWARDS across exactly the links a cycle would run round.
    while (cur && guard++ < 40) {
      const parent = parentOf(cur);
      if (!parent) break;
      survives.add(parent);
      cur = byId(areas, parent);
    }
  }
  for (const { area, depth } of flattenTree(areas)) {
    if (!survives.has(area.id)) continue;
    out.push({ area, depth, points: orderedInArea(list.filter((p) => p && (p.areaId || "") === area.id)) });
  }
  return out;
}

// ★★ WHAT A CUSTOMER MAY COLLECT FROM (v406) — **AND IT IS IN HER ORDER (v418)**.
//
// ⚠️⚠️ IT USED TO LIVE IN points.js AND READ `activePoints`, WHICH IS A FLAT LIST. Her words were
// __"after i reposition with the handle, the drop drop list have to organise is my preference"__ —
// ⚠️ **and a flat list cannot answer that here at all: `sort` is PER GROUP**, so sorting the flat
// array just interleaves the groups (a Point she dragged to the top of Sg Ara ties with one at the
// top of Prai, and neither is "first"). ⭐ **Her preference is the order the Points SCREEN draws**,
// which is the grouped one — so this is the same `groupPointsByArea` the screen and the shop read,
// flattened. **One order, three readers, and a picker that cannot disagree with the shelf it feeds.**
//
// ⚠️⚠️ THE SYNTHETIC `"My kitchen"` ROW IS A FALLBACK, NOT THE KITCHEN ITSELF. Until v406 the kitchen
// was **the absence of a Point**, so this had to invent a row for it — and her words were __"I want
// all self collection thru collection point, not from the kitchen"__. ⚠️ The fallback STAYS: an app
// with no kitchen marked must still let a customer collect, and an order carrying no `pointId` —
// every order taken before today — must go on meaning the kitchen.
export function pointChoices(state, kitchenLabel = "My kitchen") {
  const kitchen = kitchenPoint(state);
  // ★★ THIS IS THE LIST **SHE** PICKS FROM ON HER OWN ORDER CARDS.
  //
  // ⚠️⚠️ IT CARRIED A PIN GATE UNTIL v420 AND THE GATE WAS IN ENTIRELY THE WRONG PLACE. Her report:
  // __"the point i setup is not available for selection in +order, edit order and other"__ — and she
  // was right. v406 put `p.isKitchen === true || !!pointPlace(p)` here believing this was the list a
  // **customer** picks from. ⭐ **It is not: this function is called from ONE file — `views/orders.js`
  // — and from nowhere else.** The shop builds its own list from the published Points
  // (`shopPointOrder`) and has never called this one.
  //
  // ⚠️⚠️ SO THE GATE DID THE EXACT OPPOSITE OF WHAT IT WAS WRITTEN FOR. It hid her own Places from
  // HER OWN screens, while the customer's page went on offering every one of them — and it broke her
  // standing rule with it: **nothing may block or hide a sale she takes by hand.** She could not even
  // record an order collecting at a Point she had just made. ⭐ Her own words at v419 were *"every
  // point listed in store"*, and now both lists agree.
  //
  // ⚠️ AND THE PIN WAS NEVER THE RIGHT TEST ANYWAY. A pin is what a **VAN** is given. A customer
  // walking to a place is told its **ADDRESS**, which is a different field — `pointAddressFor` reads
  // that, and a Point can have one without a pin. The pin's real home is where it already is: the run
  // screen says __"this Point is not pinned yet"__ and offers **Pin the Point** beside it.
  const ordered = groupPointsByArea(state, activePoints(state)).flatMap((g) => g.points);
  const rows = kitchen ? ordered : [{ id: "", name: kitchenLabel }].concat(ordered);
  return rows.map((p) => ({ id: p.id || "", name: p.name }));
}

// The Points in the order the SHOP draws them: the unfiled block first, then each area in her
// order. ⚠️ The flat published list has to be in this order because the customer page walks it
// in order and puts a heading in front of the first Point of each area — so the order and the
// headings are one decision, taken here, rather than two that can disagree.
export function shopPointOrder(state) {
  return groupPointsByArea(state, activePoints(state)).flatMap((g) => g.points);
}

// What the customer page is told about the headings.
//
// ⚠️ ONLY AN AREA THAT CARRIES SOMETHING IS SENT. An area she has made but filed nothing into
// would otherwise draw an empty heading on the shop — a shelf with nothing on it reads as a
// broken page. The unfiled block is not sent at all: it is not a heading, it is what the
// absence of one looks like.
//
// ⚠️ IT IS ALWAYS SENT, even when empty, like the categories and the promo codes before it
// (store/app.js): the payload replaces the whole key, so an empty list is a real instruction —
// "she has no areas" — and has to take the headings off a page that is already open.
//
// ⚠️ `points` carries IDS, never names: a Point renamed after it was filed must not go missing
// from its own heading, and two areas in different parts of the tree may share a name.
export function publishPointAreas(state) {
  return groupPointsByArea(state, activePoints(state))
    .filter((g) => !!g.area)
    .map((g) => ({
      name: String(g.area.name || "").trim(),
      depth: g.depth,
      points: g.points.map((p) => p.id),
    }));
}
