// views/deliveryRoutes.js — the VAN routes her Self collection Points are served by (v419).
//
// Her words: __"now i need few delivery routes, for one day delivery run day. so point will carry
// its route info..."__ — and, told a Place could be on more than one, __"a point might belong to 2
// or more routes"__.
//
// ⭐ IT IS THE AREAS SCREEN AGAIN, FOR THE SAME JOB, and that is the point rather than laziness:
// she knows this shape already, so it is built the same way, reads the same way and — ⚠️ — is
// dragged the same way, with the same grip and the same helper in ui.js. A second way to arrange a
// list would be a second thing to learn. The ONE difference is that a route has no parent, so this
// screen is that file with the "Sits under" box taken out.
//
// ⚠️ A ROUTE CARRIES NO DAYS. Her words: __"we don control by route, we control by point"__ — the
// days live on the Point, so there is exactly one place a day is ever typed. A route is a NAME and
// a LIST OF MEMBERS, and nothing else.
//
// ⚠️ AND IT IS NEVER PUBLISHED TO THE SHOP. A customer has no business knowing her vans: the
// customer page has no route heading and no route line, so this screen saves and syncs and touches
// nothing a customer reads. That is why there is no `maybeSyncStorefront` below — an area has to
// republish because the shop draws its headings, and a route does not.
//
// ⚠️ THE NAMES ARE NOT TRANSLATED, the same as a Point's and an area's: they are her data, and a
// customer never sees them anyway.

import { el, button, emptyState, confirmDialog, showPopup, toast, wireRowReorder } from "../ui.js";
import { save } from "../state.js";
import { maybeSync } from "../supabase.js";
import { addRoute, moveRoute, pointsOnRoute, routeNameProblem, routesOf, updateRoute } from "../deliveryRoutes.js";

export function renderDeliveryRoutes(root, state) {
  renderAll(root, state);
}

const all = (state) => (Array.isArray(state.deliveryRoutes) ? state.deliveryRoutes : []);

// One route's second line: what it is for, and how many Places are on it.
//
// ⚠️ "POINT" IS THE WORD THE REST OF THE APP USES — the More row says "Self collection Points" and
// the areas screen says "no Points filed here yet" — so this screen says it too. One screen, one
// name: a second word for the same thing is the fault `screen-names.test.js` exists to catch.
function subLine(state, route) {
  const held = pointsOnRoute(state, route.id);
  return held
    ? `${held} Point${held === 1 ? "" : "s"} on this route`
    : "no Points on this route yet";
}

function renderAll(root, state) {
  // A redraw must not move her: adding, editing, dragging or deleting a row repaints this list.
  const y = typeof window !== "undefined" ? window.scrollY : 0;
  const rows = routesOf(state);
  root.replaceChildren(
    newRouteCard(state, root),
    el("h2", { class: "section" }, `Delivery routes (${rows.length})`),
    ...(rows.length
      ? [el("div", { class: "cat-list" }, ...rows.map((r) => routeRow(state, r, root)))]
      : [emptyState("No routes yet",
        "A route is one van's run — the Places it visits. Make one (e.g. Route A), then put your Places on it, "
        + "one or several each, on the Self collection Points screen. The delivery run then groups a day's stops "
        + "by the route they are on.")]));
  if (y && typeof window !== "undefined") window.scrollTo(0, y);
}

// ★★ TUGGING ONE CUSTOMER'S DOORSTEP INTO A ROUTE, BY HAND, FOR THAT DAY (v421).
//
// Her words: __"how do i tug in any other point to a route already named for that day?"__ — and then,
// correcting what she meant, twice: __"not any other point but any other customer delivery?"__ and
// __"not to belong but i manually tug into a route"__.
//
// ⭐⭐ **"TUG", AND NOT "BELONG", AND THE DIFFERENCE IS THE WHOLE DESIGN.** ⚠️ She is describing an
// ACTION she takes on a run day — pull this doorstep into this van's group — **not a standing
// attribute** of a customer or an order. ⭐ **So the control below says "tug" and nothing else**, and
// the field it writes is read back the same way: where a doorstep sits on TODAY'S run.
//
// ⚠️⚠️ THAT IS WHY IT LIVES ON THE **ORDER** AND NOT ON THE CUSTOMER. Her own phrase was *"for that
// day"*: a route written onto a customer's own record would be a PERMANENT change made by a passing
// arrangement, and **nothing of hers is rewritten by a plan.** ⭐ A PLACE is the opposite case — a
// standing arrangement — which is why a Place's routes live on the Place, where v419 put them.
// **One idea, two homes, and the difference is hers.**
//
// ⚠️ AND IT IS WRITTEN TO EVERY LINE OF THE GROUP, because a cart is ONE doorstep: a group whose lines
// disagreed about their route would draw under two headings and be priced as two stops.
// ⚠️ Clearing it writes `""` rather than removing the key, matching how every other cleared field on an
// order is stored — a doorstep never tugged and one tugged back out read exactly the same.
export function openRoutePicker(state, group, after) {
  const lines = (group && group.orders) || [];
  const current = () => String((lines[0] && lines[0].routeId) || "");
  const pick = (id) => {
    for (const o of lines) o.routeId = id;
    save(state);
    maybeSync(state);
    if (after) after();
  };
  showPopup(el("div", { class: "popup-title-row" }, "Tug this doorstep into a route"), (refresh, close) => {
    // Read inside, so the list is the one that is true at the moment the pop-up is drawn.
    const routes = routesOf(state);
    const nameBox = el("input", { class: "input", placeholder: "e.g. Route C" });
    return el("div", {},
      el("p", { class: "card-sub" },
        "This groups the doorstep with the Places one van is doing, for this day. It does not put it "
        + "on a van for you — you still tick the run as you always have."),
      routes.length
        ? el("div", { class: "btn-row" },
            ...routes.map((r) => button(
              r.id === current() ? `${r.name} — already on it` : r.name,
              () => { pick(r.id); close(); },
              r.id === current() ? "soft" : "ghost")),
            current() ? button("Take it back out", () => { pick(""); close(); }, "ghost") : null)
        // ★★ AND WHEN SHE HAS NO ROUTE AT ALL, THE SAME POP-UP MAKES ONE (v421). Her words: __"if there
        // is no collection point route, i would choose to create manual route, tag doors into same
        // manual route"__.
        // ⚠️⚠️ WITHOUT THIS THE TAG WAS A DEAD END: the press appeared only once she already had a
        // route, so from a run day with none there was NO WAY IN — a control she cannot reach is the
        // fault this app calls a bug, and **the way in was hidden behind the thing it makes.**
        : el("p", { class: "card-sub", style: "margin:0" },
            "No routes yet. Give one a name here and this doorstep goes straight onto it."),
      el("div", { class: "field" },
        el("label", {}, routes.length ? "Or make a new one" : "Route name"),
        nameBox,
        el("p", { class: "hint" },
          // ⚠️ NO WARNING GLYPH HERE. It is reassurance, not a caution — a route made on a run day is
          // the SAME LIST as the rest, so it can carry Places too and it is there again next week. A
          // warning mark in front of a good fact is a mark that stops meaning anything.
          "A route made here is an ordinary route, on the same list as the rest — so it can carry "
          + "Places too, and it is there again next week.")),
      el("div", { class: "btn-row" },
        button("Make it and tug this doorstep in", () => {
          const problem = routeNameProblem(state, nameBox.value, "");
          if (problem) return toast(problem);
          const row = addRoute(state, { name: nameBox.value });
          if (!row) return toast("That route could not be made");
          pick(row.id);
          toast(`${row.name} made, and this doorstep is on it`);
          close();
        }, "primary")));
  }, { wide: true });
}

function buildRouteEditor(state, route) {
  const nameBox = el("input", { class: "input", placeholder: "e.g. Route A",
    value: route ? String(route.name || "") : "" });

  function collect() {
    const n = nameBox.value.trim();
    const problem = routeNameProblem(state, n, route ? route.id : "");
    return problem ? { error: problem } : { values: { name: n } };
  }

  const fields = [
    el("div", { class: "field" }, el("label", {}, "Name"), nameBox),
  ];
  return { fields, collect };
}

function newRouteCard(state, root) {
  const editor = buildRouteEditor(state, null);
  return el("div", { class: "card" },
    el("h3", { style: "margin:0 0 10px" }, "New route"),
    ...editor.fields,
    button("Add route", () => {
      const { error, values } = editor.collect();
      if (error) return toast(error);
      // A new route goes to the END of the list: the order she has already set is hers, and a fresh
      // row must not push itself into the middle of it. ⚠️ `addRoute` writes it through `state`
      // (with `||=`), never through the `all()` helper above — that returns a fresh empty array for
      // a missing list, so pushing into it would drop the new route on the floor AND leave the
      // screen looking like it worked.
      addRoute(state, values);
      toast("Route added");
      save(state);
      renderAll(root, state);
    }, "block primary"));
}

function openEditRoutePopup(state, route, root) {
  const editor = buildRouteEditor(state, route);
  showPopup(el("div", { class: "popup-title-row" }, "Edit route"), (refresh, close) => {
    return el("div", {},
      ...editor.fields,
      el("div", { class: "popup-actions" },
        button("Cancel", close, "ghost"),
        button("Update route", () => {
          const { error, values } = editor.collect();
          if (error) return toast(error);
          // ⚠️ A RENAME MUST NOT TOUCH THE ORDER OR THE MEMBERS. `updateRoute` carries `sort` from
          // the stored row whenever the draft omits it, which is the trap `updatePoint` documents —
          // and a route's members live on the POINTS (`point.routeIds`), so nothing here reaches
          // them at all and renaming a route cannot take a Place off it.
          updateRoute(state, route.id, values);
          toast("Route updated");
          save(state);
          close();
          renderAll(root, state);
        }, "primary")));
  }, { wide: true });
}

function routeRow(state, route, root) {
  // A drag handle, not a button: the keyboard has no reorder (she asked for a drag, not arrows), so
  // it is hidden from assistive tech rather than announced as something that cannot be worked from
  // the keyboard.
  const handle = el("span", { class: "cat-handle", title: "Drag to reorder", "aria-hidden": "true" }, "⠿");
  const row = el("div", {
    class: "card cat-row",
    dataset: { id: route.id },
  },
    handle,
    el("div", { class: "cat-row-text" },
      el("p", { class: "card-title" }, String(route.name || "")),
      el("p", { class: "card-sub" }, subLine(state, route))),
    el("div", { class: "li-right" },
      button("Edit", () => openEditRoutePopup(state, route, root), "ghost small"),
      button("Delete", () => deleteRoute(state, route, root), "ghost small")));

  wireRowReorder({
    row,
    handle,
    // ⚠️ A FUNCTION, NOT THE ELEMENT: a row is wired before it is put in the list, so it has no
    // parent yet — and the helper calls this AFTER `onDrop` has returned and the node has moved.
    boxOf: () => row.parentElement,
    rowSelector: "cat-row",
    // ⚠️ EVERY row on this screen is a brother — a route has no parent, so unlike the areas screen
    // there is nothing to exclude and no `kin` to narrow it with: a drop may land anywhere.
    onDrop: (slot) => {
      moveRoute(state, route.id, slot);
      save(state);
    },
  });
  return row;
}

// ⚠️ ONE REASON TO REFUSE, AND IT IS ABOUT SOMETHING GOING MISSING RATHER THAN BEING TIDY — the same
// answer, and the same words, the areas screen gives. A Place would not be orphaned (it keeps its
// other routes, and a Place on no route simply draws first on the run screen with no heading), but it
// would come off her route without her asking, so she is told to move it first.
function deleteRoute(state, route, root) {
  const name = String(route.name || "");
  const held = pointsOnRoute(state, route.id);
  if (held) {
    return toast(`Can't delete "${name}" — ${held} Point${held === 1 ? " is" : "s are"} on this route. Take ${held === 1 ? "it" : "them"} off first.`);
  }
  confirmDialog(`Delete the route "${name}"?`, () => {
    state.deliveryRoutes = all(state).filter((r) => r.id !== route.id);
    toast("Route deleted");
    save(state);
    renderAll(root, state);
  }, { danger: true, yesLabel: "Delete" });
}
