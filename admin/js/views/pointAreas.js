// views/pointAreas.js — the areas her Self collection Points are grouped under (v410).
//
// Her words: __"i need something like category for product on POINT. 1st level 2nd level, 3rd
// level....example top level is Penang Island & Prai. Under Penang Island will be Area like Sg Ara,
// Balik Pulau, Farlim, Georgetown"__.
//
// ⭐ IT IS THE CATEGORIES SCREEN AGAIN, FOR THE SAME JOB, and that is the point rather than
// laziness: she named the thing she already knows ("something like category for product"), so it
// is built the same way, reads the same way and — ⚠️ — is dragged the same way, with the same grip
// and the same helper in ui.js. A second way to arrange a list would be a second thing to learn.
//
// Two inherited rules, both deliberate:
//
// 1. A drag reorders among BROTHERS. Moving an area under a different parent is the Edit pop-up's
//    "Sits under" box, not a drop. Reading a sideways drop as "re-parent" is a rule you have to be
//    taught, and a wrong drop in a tree can hide a whole branch behind a heading that moved. While
//    a row is in the air every row that is not one of its brothers dims, so the reach of the drag
//    is visible before she lets go.
// 2. Order is a stored `sort` on each record, renumbered across the dropped group — never the
//    array position, because the cloud carries whole records keyed by id (sync.js computeRecords).
//
// ⚠️ AND AN AREA CARRIES NO RULES. No fee, no smallest basket, no collection window, no pin. It is
// a heading, and a heading that carried rules would be a second place those rules live — see
// pointAreas.js for why it is a separate list rather than a field on a Point.
//
// ⚠️ THE NAMES ARE NOT TRANSLATED, and that is consistent rather than unfinished: a Self collection
// Point's own name is her data and is never translated either — a customer reads "Sg Ara" in
// English on a page set to Mandarin today — so an area named "Penang Island" behaves the same way.

import { el, button, emptyState, confirmDialog, showPopup, toast, wireRowReorder } from "../ui.js";
import { newId, save } from "../state.js";
import { childrenOf, flattenTree, pathTo, pointCountInArea, subtreeIds } from "../pointAreas.js";
import { maybeSyncStorefront } from "../supabase.js";

export function renderPointAreas(root, state) {
  renderAll(root, state);
}

const name = (a) => String(a.name || "").trim();
const all = (state) => (Array.isArray(state.pointAreas) ? state.pointAreas : []);

// One area's second line: where it hangs from, then what it holds.
function subLine(state, area, depth) {
  const bits = [];
  if (depth) {
    const parents = pathTo(all(state), area.id).slice(0, -1).map(name);
    if (parents.length) bits.push(`in ${parents.join(" › ")}`);
  }
  const kids = childrenOf(all(state), area.id).length;
  if (kids) bits.push(`${kids} sub-area${kids === 1 ? "" : "s"}`);
  // What her shop actually draws under this heading. It counts PAUSED Points too — they are filed
  // here and the number is about her own record, the same split the Categories screen keeps.
  const held = pointCountInArea(state, area.id);
  bits.push(held ? `${held} Point${held === 1 ? "" : "s"} filed here` : "no Points filed here yet");
  return bits.join(" · ");
}

function renderAll(root, state) {
  // A redraw must not move her: adding, editing, dragging or deleting a row repaints this list.
  const y = typeof window !== "undefined" ? window.scrollY : 0;
  const list = all(state);
  const rows = flattenTree(list);
  root.replaceChildren(
    newAreaCard(state, root),
    el("h2", { class: "section" }, `Collection areas (${list.length})`),
    ...(rows.length
      ? [el("div", { class: "cat-list" }, ...rows.map((r) => areaRow(state, r, root)))]
      : [emptyState("No areas yet",
        "An area groups your collection Points — Penang Island, Prai — so a customer can find his own neighbourhood instead of reading the whole list. Add one (e.g. Penang Island), then file your Points under it on the Self collection Points screen.")]));
  if (y && typeof window !== "undefined") window.scrollTo(0, y);
}

// The "Sits under" picker, shared by the add card and the Edit pop-up. It leaves out the area
// itself and everything under it: dropping an area inside its own subtree would cut that branch
// off the root, and leaving those options out is what makes a cycle impossible to type rather than
// something the screen has to complain about afterwards.
function parentPicker(state, value, exclude = new Set()) {
  const options = [el("option", { value: "", selected: !value }, "— Top level —")];
  for (const { area, depth } of flattenTree(all(state))) {
    if (exclude.has(area.id)) continue;
    options.push(el("option", { value: area.id, selected: area.id === value },
      `${"  ".repeat(depth)}${depth ? "└ " : ""}${name(area)}`));
  }
  return el("select", { class: "input" }, options);
}

function buildAreaEditor(state, area) {
  const exclude = area ? subtreeIds(all(state), area.id) : new Set();
  const nameBox = el("input", { class: "input", placeholder: "e.g. Penang Island",
    value: area ? String(area.name || "") : "" });
  const parent = parentPicker(state, area ? (area.parentId || "") : "", exclude);

  function collect() {
    const n = nameBox.value.trim();
    if (!n) return { error: "The area needs a name" };
    if (all(state).some((a) => a !== area && name(a).toLowerCase() === n.toLowerCase())) {
      return { error: `An area called "${n}" already exists` };
    }
    return { values: { name: n, parentId: parent.value || "" } };
  }

  const fields = [
    el("div", { class: "field" }, el("label", {}, "Name"), nameBox),
    el("div", { class: "field" }, el("label", {}, "Sits under"), parent,
      el("p", { class: "hint" },
        "Leave on Top level for a main area like Penang Island, or pick one to nest this under it — "
        + "so Sg Ara sits inside Penang Island. Any depth, and the shop indents them to match.")),
  ];
  return { fields, collect };
}

function newAreaCard(state, root) {
  const editor = buildAreaEditor(state, null);
  return el("div", { class: "card" },
    el("h3", { style: "margin:0 0 10px" }, "New area"),
    ...editor.fields,
    button("Add area", () => {
      const { error, values } = editor.collect();
      if (error) return toast(error);
      // A new area goes to the END of its group: the order she has already set is hers, and a
      // fresh row must not push itself into the middle of it.
      const brothers = childrenOf(all(state), values.parentId);
      // ⚠️ `||=` RATHER THAN A BARE `.push`, the same spelling `addPoint` uses in points.js. The
      // list is seeded by `state.js` and guarded on load, so in the app it is always there — but a
      // state that predates this version, or a screen test's own fixture, is not, and
      // `undefined.push` is a dead Add button. ⚠️ And it must be written THROUGH `state`, not
      // through `all(state)` above: that helper returns a fresh empty array for a missing list, so
      // pushing into it would drop the new area on the floor **and** leave the screen looking like
      // it worked.
      (state.pointAreas ||= []).push({ id: newId("pa"), ...values, sort: brothers.length });
      toast("Area added");
      save(state);
      maybeSyncStorefront(state); // the headings are what the shop lists under
      renderAll(root, state);
    }, "block primary"));
}

function openEditAreaPopup(state, area, root) {
  const editor = buildAreaEditor(state, area);
  showPopup(el("div", { class: "popup-title-row" }, "Edit area"), (refresh, close) => {
    return el("div", {},
      ...editor.fields,
      el("div", { class: "popup-actions" },
        button("Cancel", close, "ghost"),
        button("Update area", () => {
          const { error, values } = editor.collect();
          if (error) return toast(error);
          Object.assign(area, values);
          // Landing under a different parent puts it last among its new brothers: where it sat
          // among the old ones says nothing about where it belongs among these.
          const brothers = childrenOf(all(state), values.parentId).filter((a) => a.id !== area.id);
          area.sort = brothers.length;
          toast("Area updated");
          save(state);
          maybeSyncStorefront(state); // a renamed or re-parented heading reaches the shop
          close();
          renderAll(root, state);
        }, "primary")));
  }, { wide: true });
}

function areaRow(state, { area, depth }, root) {
  // A drag handle, not a button: the keyboard has no reorder (she asked for a drag, not arrows),
  // so it is hidden from assistive tech rather than announced as something that cannot be worked
  // from the keyboard.
  const handle = el("span", { class: "cat-handle", title: "Drag to reorder", "aria-hidden": "true" }, "⠿");
  const row = el("div", {
    class: "card cat-row",
    dataset: { id: area.id },
    style: `--depth:${depth}`,
  },
    handle,
    el("div", { class: "cat-row-text" },
      el("p", { class: "card-title" }, name(area)),
      el("p", { class: "card-sub" }, subLine(state, area, depth))),
    el("div", { class: "li-right" },
      button("Edit", () => openEditAreaPopup(state, area, root), "ghost small"),
      button("Delete", () => deleteArea(state, area, root), "ghost small")));

  wireRowReorder({
    row,
    handle,
    boxOf: () => row.parentElement,
    rowSelector: "cat-row",
    // A drop may land among this area's brothers and nowhere else — see the header.
    kin: (n) => {
      const a = all(state).find((x) => x.id === n.dataset.id);
      return !!a && (a.parentId || "") === (area.parentId || "");
    },
    onDrop: (slot) => {
      state.pointAreas = moveTo(state.pointAreas, area.id, slot);
      save(state);
      maybeSyncStorefront(state); // the order she just set is the order customers see
    },
  });
  return row;
}

// Renumber the moved area's brothers 0,1,2… and hand back a new list. `toIndex` counts the OTHER
// brothers, which is what the marker shows.
function moveTo(list, id, toIndex) {
  const area = (list || []).find((a) => a && a.id === id);
  if (!area) return list;
  const siblings = childrenOf(list, area.parentId || "").filter((a) => a.id !== id);
  const at = Math.max(0, Math.min(Number(toIndex) || 0, siblings.length));
  const ordered = [...siblings.slice(0, at), area, ...siblings.slice(at)];
  const rank = new Map(ordered.map((a, i) => [a.id, i]));
  return (list || []).map((a) => (a && rank.has(a.id) ? { ...a, sort: rank.get(a.id) } : a));
}

// ⚠️ TWO REASONS TO REFUSE, AND BOTH ARE ABOUT SOMETHING GOING MISSING RATHER THAN BEING TIDY.
// A sub-area would be orphaned — cut off the root, reachable by nothing and drawn nowhere. A filed
// Point would not be orphaned (it falls to the "No area yet" block at the top of the Points screen,
// in plain sight) but it would move under her without her asking, so she is told to move it first.
function deleteArea(state, area, root) {
  const kids = childrenOf(all(state), area.id).length;
  if (kids) {
    return toast(`Can't delete "${name(area)}" — it has ${kids} sub-area${kids === 1 ? "" : "s"} under it. Delete those first, or move them out.`);
  }
  const held = pointCountInArea(state, area.id);
  if (held) {
    return toast(`Can't delete "${name(area)}" — ${held} Point${held === 1 ? " is" : "s are"} filed here. Move ${held === 1 ? "it" : "them"} to another area first.`);
  }
  confirmDialog(`Delete the area "${name(area)}"?`, () => {
    state.pointAreas = all(state).filter((a) => a.id !== area.id);
    toast("Area deleted");
    save(state);
    maybeSyncStorefront(state); // the heading comes off the shop
    renderAll(root, state);
  }, { danger: true, yesLabel: "Delete" });
}
