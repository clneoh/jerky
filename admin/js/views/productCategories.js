// views/productCategories.js — the headings the shop's products are listed
// under. Her list starts empty and she builds it: a category exists only
// because she typed one. Same shape as Ingredients/Units/Suppliers — always-on
// "New category" card, rows, Edit pop-up — with two things of its own.
//
// 1. A category may sit under another one, to any depth (For Dog › Treats), and
//    the rows are drawn as that tree: indented, and labelled with the path it
//    hangs from so a nested row still says where it lives.
// 2. The rows are DRAGGED into order, because the order here is the order the
//    shop lists them in and she asked to set it herself.
//
// A drag reorders among BROTHERS. Moving a category under a different parent is
// the Edit pop-up's "Sits under" box, not a drop, and that is deliberate:
// reading a sideways drop as "re-parent" is a rule you have to be taught, and a
// wrong drop in a tree can hide a whole branch behind a heading that moved.
// Instead, while a row is in the air, every row that is not one of its brothers
// dims — so the reach of the drag is visible before she lets go rather than
// after. The ORDER is what she asked to drag; the PARENT has a named control
// that says what it does.
//
// Order is stored as `sort` on each record and renumbered across the dropped
// group. It cannot be the array position: the cloud carries whole records keyed
// by id, so a row's place in the array never travels between her phones
// (admin/js/sync.js computeRecords).

import { el, button, emptyState, confirmDialog, showPopup, toast, wireRowReorder } from "../ui.js";
import { newId, save } from "../state.js";
import { childrenOf, flattenTree, listedCount, pathTo, productCount, subtreeIds } from "../productCategories.js";
import { maybeSyncStorefront } from "../supabase.js";

export function renderProductCategories(root, state) {
  renderAll(root, state);
}

const name = (c) => String(c.name || "").trim();

// One category's second line: where it hangs from, then what it holds.
function subLine(state, cat, depth) {
  const bits = [];
  if (depth) {
    const parents = pathTo(state.productCategories, cat.id).slice(0, -1).map(name);
    if (parents.length) bits.push(`in ${parents.join(" › ")}`);
  }
  const kids = childrenOf(state.productCategories, cat.id).length;
  if (kids) bits.push(`${kids} sub-categor${kids === 1 ? "y" : "ies"}`);
  // What the SHOP shows under this heading — a number she can go and count on
  // the customer page. A product she has since ticked into a later category is
  // still filed here but listed there, so it is counted out and named in the
  // tail instead: a bare "2 products" over a heading the shop draws one product
  // under reads as a bug.
  const listed = listedCount(state, cat.id);
  bits.push(listed ? `${listed} product${listed === 1 ? "" : "s"}` : "no products yet");
  const extra = productCount(state, cat.id) - listed;
  if (extra > 0) bits.push(`${extra} more ticked here, listed elsewhere`);
  return bits.join(" · ");
}

function renderAll(root, state) {
  // A redraw must not move her: adding, editing or deleting a row here repaints
  // the list, and coming back to the top of a long tree would lose her place.
  const y = typeof window !== "undefined" ? window.scrollY : 0;
  const list = state.productCategories || [];
  const rows = flattenTree(list);
  root.replaceChildren(
    newCategoryCard(state, root),
    el("h2", { class: "section" }, `Categories (${list.length})`),
    ...(rows.length
      ? [el("div", { class: "cat-list" }, ...rows.map((r) => categoryRow(state, r, root)))]
      : [emptyState("No categories yet",
        "Add one (e.g. Food, Drink). Products you file into it are listed under that heading on the shop, in this order.")]));
  if (y && typeof window !== "undefined") window.scrollTo(0, y);
}

// The "Sits under" picker, shared by the add card and the Edit pop-up. It leaves
// out the category itself and everything under it: dropping a category inside
// its own subtree would cut that branch off the root, and leaving those options
// out is what makes a cycle impossible to type rather than something the screen
// has to complain about afterwards.
function parentPicker(state, value, exclude = new Set()) {
  const options = [el("option", { value: "", selected: !value }, "— Top level —")];
  for (const { cat, depth } of flattenTree(state.productCategories)) {
    if (exclude.has(cat.id)) continue;
    options.push(el("option", {
      value: cat.id,
      selected: cat.id === value,
    }, `${"  ".repeat(depth)}${depth ? "└ " : ""}${name(cat)}`));
  }
  return el("select", { class: "input" }, options);
}

function buildCategoryEditor(state, cat) {
  const exclude = cat ? subtreeIds(state.productCategories, cat.id) : new Set();
  const nameBox = el("input", { class: "input", placeholder: "e.g. Food",
    "data-suggest": "Food", value: cat ? String(cat.name || "") : "" });
  const zhBox = el("input", { class: "input", placeholder: "中文",
    value: cat ? String(cat.nameZh || "") : "" });
  const msBox = el("input", { class: "input", placeholder: "Bahasa Malaysia",
    value: cat ? String(cat.nameMs || "") : "" });
  const parent = parentPicker(state, cat ? (cat.parentId || "") : "", exclude);

  function collect() {
    const n = nameBox.value.trim();
    if (!n) return { error: "The category needs a name" };
    if ((state.productCategories || []).some((c) => c !== cat && name(c).toLowerCase() === n.toLowerCase())) {
      return { error: `A category called "${n}" already exists` };
    }
    return { values: {
      name: n,
      nameZh: zhBox.value.trim() || undefined,
      nameMs: msBox.value.trim() || undefined,
      parentId: parent.value || "",
    } };
  }

  const fields = [
    el("div", { class: "field" }, el("label", {}, "Name"), nameBox),
    el("div", { class: "field" }, el("label", {}, "Chinese"), zhBox,
      el("p", { class: "hint" }, "Optional. The heading falls back to English while this is blank.")),
    el("div", { class: "field" }, el("label", {}, "Bahasa Malaysia"), msBox,
      el("p", { class: "hint" }, "Optional.")),
    el("div", { class: "field" }, el("label", {}, "Sits under"), parent,
      el("p", { class: "hint" }, "Leave on Top level for a main heading, or pick a category to nest this one under it.")),
  ];
  return { fields, collect };
}

function newCategoryCard(state, root) {
  const editor = buildCategoryEditor(state, null);
  return el("div", { class: "card" },
    el("h3", { style: "margin:0 0 10px" }, "New category"),
    ...editor.fields,
    button("Add category", () => {
      const { error, values } = editor.collect();
      if (error) return toast(error);
      // A new category goes to the END of its group: the order she has already
      // set is hers, and a fresh row must not push itself into the middle of it.
      const brothers = childrenOf(state.productCategories, values.parentId);
      state.productCategories.push({ id: newId("cat"), ...values, sort: brothers.length });
      toast("Category added");
      save(state);
      maybeSyncStorefront(state); // the headings are what the shop lists under
      renderAll(root, state);
    }, "block primary"));
}

function openEditCategoryPopup(state, cat, root) {
  const editor = buildCategoryEditor(state, cat);
  showPopup(el("div", { class: "popup-title-row" }, "Edit category"), (refresh, close) => {
    return el("div", {},
      ...editor.fields,
      el("div", { class: "popup-actions" },
        button("Cancel", close, "ghost"),
        button("Update category", () => {
          const { error, values } = editor.collect();
          if (error) return toast(error);
          Object.assign(cat, values);
          // Landing under a different parent puts it last among its new
          // brothers: where it sat among the old ones says nothing about where
          // it belongs among these.
          const brothers = childrenOf(state.productCategories, values.parentId)
            .filter((c) => c.id !== cat.id);
          cat.sort = brothers.length;
          toast("Category updated");
          save(state);
          maybeSyncStorefront(state); // a renamed or re-parented heading reaches the shop
          close();
          renderAll(root, state);
        }, "primary")));
  }, { wide: true });
}

function categoryRow(state, { cat, depth }, root) {
  // A drag handle, not a button: the keyboard has no reorder (she asked for a
  // drag, not ↑/↓), so it is hidden from assistive tech rather than announced as
  // something that cannot be worked from the keyboard.
  const handle = el("span", { class: "cat-handle", title: "Drag to reorder", "aria-hidden": "true" }, "⠿");
  const row = el("div", {
    class: "card cat-row",
    dataset: { id: cat.id },
    style: `--depth:${depth}`,
  },
    handle,
    el("div", { class: "cat-row-text" },
      el("p", { class: "card-title" }, name(cat)),
      el("p", { class: "card-sub" }, subLine(state, cat, depth))),
    el("div", { class: "li-right" },
      button("Edit", () => openEditCategoryPopup(state, cat, root), "ghost small"),
      button("Delete", () => deleteCategory(state, cat, root), "ghost small")));
  wireRowReorder({
    row,
    handle,
    boxOf: () => row.parentElement,
    rowSelector: "cat-row",
    // A drop may land among this category's brothers and nowhere else: moving a
    // category under a different parent is the Edit pop-up's job, and a drop
    // among cousins that silently re-parented would be a much bigger change
    // than the gesture looks like it makes. Only the row's own id is read, so a
    // stale record elsewhere on the screen cannot change the answer.
    kin: (n) => {
      const c = (state.productCategories || []).find((x) => x.id === n.dataset.id);
      return !!c && (c.parentId || "") === (cat.parentId || "");
    },
    onDrop: (slot) => {
      state.productCategories = moveTo(state.productCategories, cat.id, slot);
      save(state);
      maybeSyncStorefront(state); // the order she just set is the order customers see
    },
  });
  return row;
}

// Renumber the moved category's brothers 0,1,2… and hand back a new list.
// `toIndex` counts the OTHER brothers, which is what the marker shows.
function moveTo(list, id, toIndex) {
  const cat = (list || []).find((c) => c && c.id === id);
  if (!cat) return list;
  const siblings = childrenOf(list, cat.parentId || "").filter((c) => c.id !== id);
  const at = Math.max(0, Math.min(Number(toIndex) || 0, siblings.length));
  const ordered = [...siblings.slice(0, at), cat, ...siblings.slice(at)];
  const rank = new Map(ordered.map((c, i) => [c.id, i]));
  return (list || []).map((c) => (c && rank.has(c.id) ? { ...c, sort: rank.get(c.id) } : c));
}

function deleteCategory(state, cat, root) {
  const kids = childrenOf(state.productCategories, cat.id).length;
  if (kids) {
    return toast(`Can't delete "${name(cat)}" — it has ${kids} sub-categor${kids === 1 ? "y" : "ies"}. Delete or move those first.`);
  }
  const filed = productCount(state, cat.id);
  if (filed) {
    return toast(`Can't delete "${name(cat)}" — ${filed} product${filed === 1 ? " is" : "s are"} filed here. Move them to another category first.`);
  }
  confirmDialog(`Delete category "${name(cat)}"?`, () => {
    state.productCategories = state.productCategories.filter((c) => c.id !== cat.id);
    toast("Category deleted");
    save(state);
    maybeSyncStorefront(state); // the shop must stop drawing a heading she removed
    renderAll(root, state);
  }, { danger: true, yesLabel: "Delete" });
}
