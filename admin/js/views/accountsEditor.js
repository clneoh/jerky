// views/accountsEditor.js — editing one entry of the two lists (16 Sep 2026): a
// category, or a way to pay. It is an INLINE form, never a pop-up of its own,
// because every place it is opened from is already inside one: showPopup() owns a
// single shared layer, so a second pop-up would wipe out the expense form (or the
// lists screen) underneath it. The date field in the app expands the same way, for
// the same reason.
//
// Reached from a ＋ chip on the expense / money-in forms (the moment she needs a name
// that is not on the list) and from every line of the lists screen.
//
// RENAMING rewrites the label on the rows already recorded under it. A row stores the
// words it was written with, so a rename that only changed the list would split her
// history in two: some rows under "Packaging", the rest under "Packing". Deleting is
// the opposite case and deliberately leaves them alone — see accounts.js.
import { el, button, toast, confirmDialog } from "../ui.js";
import { save } from "../state.js";
import { maybeSync } from "../supabase.js";
import { categoriesOf, methodsOf } from "../accounts.js";

const CLASS_CHOICES = [
  ["expense", "A running cost"],
  ["stock", "Ingredients"],
  ["drawing", "My own money"],
];

const rewrite = (state, listKey, field, from, to) => {
  for (const row of state[listKey] || []) {
    if (row && row[field] === from) row[field] = to;
  }
};

// The one form. `current` is the label being changed, or "" for a new entry. Returns
// the field; `onDone(label)` runs after a successful save (the label, so a caller can
// select it), and `onDone("")` after a delete.
export function entryForm(state, { kind, current = "", onDone }) {
  const isCategory = kind === "category";
  // Both lists read as { label, cls }: the ways to pay are plain strings, and the
  // category-only `cls` is what tells the statement where a cost belongs.
  const list = isCategory ? categoriesOf(state) : methodsOf(state).map((m) => ({ label: m, cls: "" }));
  const existing = list.find((c) => c.label === current);
  const others = list.filter((c) => c.label !== current).map((c) => c.label);

  const name = el("input", { class: "input", value: current,
    placeholder: isCategory ? "e.g. Pet expo" : "e.g. Bank OD", "aria-label": "Name" });
  let cls = existing && existing.cls ? existing.cls : "expense";
  const clsPills = el("div", { class: "cal-modes" },
    ...CLASS_CHOICES.map(([id, text]) => button(text, () => {
      cls = id;
      for (const b of clsPills.children) b.classList.toggle("cal-mode-on", b.textContent === text);
    }, `ghost small${id === cls ? " cal-mode-on" : ""}`)));

  const commit = () => {
    const label = name.value.trim();
    if (!label) return toast(isCategory ? "Type a name for the category" : "Type a name for it");
    if (others.some((o) => o.toLowerCase() === label.toLowerCase())) {
      return toast("That one is already on the list");
    }
    if (isCategory) {
      state.settings.categories = current
        ? list.map((c) => (c.label === current ? { label, cls } : { label: c.label, cls: c.cls || "expense" }))
        : [...list.map((c) => ({ label: c.label, cls: c.cls || "expense" })), { label, cls }];
      if (current && current !== label) rewrite(state, "expenses", "category", current, label);
    } else {
      state.settings.payMethods = current
        ? list.map((c) => (c.label === current ? label : c.label))
        : [...list.map((c) => c.label), label];
      if (current && current !== label) {
        rewrite(state, "expenses", "method", current, label);
        rewrite(state, "deposits", "method", current, label);
      }
    }
    save(state);
    maybeSync(state);
    toast(current ? "Updated" : (isCategory ? "Category added" : "Added"));
    if (onDone) onDone(label);
  };

  const remove = () => {
    const kept = list.filter((c) => c.label !== current);
    if (!kept.length) return toast("Keep at least one");
    confirmDialog(
      isCategory
        ? `Delete the "${current}" category? Expenses already recorded under it are kept, and still count on the statement.`
        : `Delete "${current}"? Entries already recorded as paid that way are kept.`,
      () => {
        if (isCategory) state.settings.categories = kept;
        else state.settings.payMethods = kept.map((c) => c.label);
        save(state);
        maybeSync(state);
        toast("Deleted");
        if (onDone) onDone("");
      }, { danger: true, yesLabel: "Delete" });
  };

  return el("div", { class: "entry-form" },
    el("p", { class: "card-sub", style: "margin:0 0 6px" },
      isCategory
        ? "What an expense was for. Its kind tells the Profit statement where it belongs; renaming it moves what you have already recorded with it."
        : "How the money moved. Cash and TNG come out of your purse or your phone; anything else — a loan, the bank overdraft — is kept out of those figures."),
    name,
    isCategory ? clsPills : null,
    el("div", { class: "btn-row", style: "margin-top:8px" },
      current ? button("Delete", remove, "danger small") : null,
      button("Cancel", () => { if (onDone) onDone(null); }, "ghost"),
      button(current ? "Save" : "Add", commit, "primary")));
}

// The ＋ chip that sits at the end of a row of pills, or under a list. Tapping it
// calls `open()`; the caller shows the inline form wherever it belongs.
export function newEntryChip(kind, open) {
  return button(kind === "category" ? "＋ New category" : "＋ New way to pay", open, "ghost small");
}
