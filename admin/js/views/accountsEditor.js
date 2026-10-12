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
import { el, button, toast, confirmDialog, showPopup } from "../ui.js";
import { save } from "../state.js";
import { maybeSync } from "../supabase.js";
import { categoriesOf, isLockedAccount, methodLabel, methodsOf, sourcesOf } from "../accounts.js";

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

// ★★ MOVING EVERYTHING RECORDED UNDER ONE ACCOUNT ONTO ANOTHER (v486).
//
// ⚠️⚠️ THIS EXISTS BECAUSE A RENAME WAS ONLY MOVING TWO OF THE THREE PLACES A METHOD IS WRITTEN.
// It rewrote `expenses.method` and `deposits.method` — ⚠️ **and NOT an order's `paidMethod`.** ⭐ So
// renaming a way to pay left every ORDER behind under the old name, and the Money screen went on
// showing a block for an account that was no longer on her list. ⭐ **That is the "Cash" block she
// asked about three times: RM 64 of her orders, still filed under a name she had retired.**
//
// ⭐ Her words: __"move the transaction it is owning to cash LS"__ — so this is a MOVE, and it is the
// same act as a rename, which is why BOTH call it now.
//
// ⚠️ AND IT IS THE v441 LESSON AGAIN — **the order's method is a word stored on every row, so every
// place that stores it has to move together.** A rename that moves two of three is worse than none:
// the figures split in silence.
export function moveAccountRecords(state, from, to) {
  const a = String(from == null ? "" : from);
  const b = String(to == null ? "" : to);
  if (!a || !b || a === b) return 0;
  let moved = 0;
  for (const key of ["expenses", "deposits"]) {
    for (const row of state[key] || []) {
      if (row && row.method === a) { row.method = b; moved++; }
    }
  }
  // ⚠️⚠️ AND THE ORDERS — the one this missed for months.
  for (const o of state.orders || []) {
    if (o && methodLabel(o.paidMethod) === methodLabel(a)) { o.paidMethod = b; moved++; }
  }
  return moved;
}

// ★★ TAKING ONE OFF A LIST — ITS OWN DOOR, SO THERE IS ONLY ONE (v481).
//
// ⚠️ SHE HAD TO ASK TWICE HOW TO DELETE AN ACCOUNT. It lived only inside the inline form, behind a tap
// on the row — and a row that LOOKS like text is not an affordance. ⭐ **Now the lists manager puts a
// Delete button on the line, beside every other list in the app**, and it calls this same function —
// so the confirmation, the "keep at least one" guard and the rows-already-recorded rule are written
// once and cannot drift apart.
export function removeEntry(state, { kind, current, onDone }) {
  const isCategory = kind === "category";
  const isSource = kind === "source";
  const list = isCategory ? categoriesOf(state)
    : isSource ? sourcesOf(state).map((m) => ({ label: m, cls: "" }))
      : methodsOf(state).map((m) => ({ label: m, cls: "" }));
  // ★★ THE BASE RULE SHE STATED: SOMETHING ALREADY USED BY A TRANSACTION CANNOT BE DELETED (v487).
  //
  // Her words, and they are the right rule: __"whatever already have transaction cannot be delete that
  // is the base rules right?"__ ⚠️ **It was NOT the app's rule** — the app let her delete an account and
  // KEPT the records under the old name, ⭐ **which is exactly the "Cash" block holding RM 64 she asked
  // about three times**: the account went, the transactions stayed, and the block sat there with no way
  // back. ⭐ **She should never have been able to do it, and now she cannot.**
  //
  // ⭐ AND IT COVERS ALL THREE LISTS, because the rule is about RECORDS, not about accounts — a category
  // an expense was filed under, a source a money-in row came from, an account anything moved through.
  // ⚠️ **Every one of those is a figure that would be split in silence by a delete.**
  const inUse = recordsUsing(state, kind, current);
  if (inUse) {
    // ⭐⭐ IT NAMES A WAY THROUGH, AND NEVER JUST A NO (v487). Her worry: __"im not sure if there is any
    // exclusion will be in the future"__. ⚠️ **A refusal with no way out is how a rule outlaws the
    // correct case later** ([[project-v439]]) — ⭐ **so the escape hatch is BOTH: rename it, or move
    // its records onto another name and then it is free to go.**
    return toast(`"${current}" is used by ${inUse} ${inUse === 1 ? "record" : "records"} — it cannot be deleted yet. Rename it, or move its records to another name, and then it can.`);
  }

  // ⚠️⚠️ AND THE TWO THE BOOKS ARE BUILT ON ARE LOCKED EVEN WITH NOTHING IN THEM (v487). Her words:
  // __"lock cash and TNG from deletion"__. ⭐ `isCash` / `isTng` are EXACT matches on those two words,
  // so deleting one leaves no account a new order can be recorded as cash with — even on a day it
  // happens to hold nothing.
  if (!isCategory && !isSource && isLockedAccount(current)) {
    return toast(`${current} cannot be deleted — the books are built on it. You can rename it instead.`);
  }
  const kept = list.filter((c) => c.label !== current);
  if (!kept.length) return toast("Keep at least one");
  confirmDialog(
    isCategory
      ? `Delete the "${current}" category? Expenses already recorded under it are kept, and still count on the statement.`
      : isSource
        ? `Delete "${current}"? Money-in rows already recorded as coming from it are kept, and still count.`
        : `Delete "${current}"? Entries already recorded as paid that way are kept.`,
    () => {
      if (isCategory) state.settings.categories = kept;
      else if (isSource) state.settings.sources = kept.map((c) => c.label);
      else state.settings.payMethods = kept.map((c) => c.label);
      save(state);
      maybeSync(state);
      toast("Deleted");
      if (onDone) onDone("");
    }, { danger: true, yesLabel: "Delete" });
}

// How many records are written against one name, on any of the three lists (v487).
//
// ⚠️ The rule is about RECORDS, not about accounts: a category an expense was filed under, a source a
// money-in row came from, an account anything moved through. ⭐ **And it is the same count the entry
// form shows and the guard refuses on**, so the two can never disagree about the same name.
export function recordsUsing(state, kind, current) {
  const label = methodLabel(current);
  const same = (v) => String(v == null ? "" : v) === current;
  if (kind === "category") return (state.expenses || []).filter((e) => e && same(e.category)).length;
  if (kind === "source") return (state.deposits || []).filter((d) => d && same(d.source)).length;
  return (state.expenses || []).filter((e) => e && methodLabel(e.method) === label).length
    + (state.deposits || []).filter((d) => d && methodLabel(d.method) === label).length
    + (state.orders || []).filter((o) => o && methodLabel(o.paidMethod) === label).length;
}

// ★★ MOVING WHAT A RETIRED ACCOUNT HOLDS ONTO ONE SHE USES (v486).
//
// ⚠️⚠️ THIS IS THE OTHER HALF OF THE BUG SHE FOUND BY ASKING THREE TIMES. An account no longer on her
// list keeps its block, because its money is still in the books — ⭐ **and she asked, fairly, what a
// block she cannot pay into is doing there.** The answer was that the records were **stranded**: a
// rename moved the expenses and the deposits and ⚠️ **left every ORDER behind**, so a retired name
// went on holding orders that no screen could move.
//
// ⭐ Her words: __"move the transaction it is owning to cash LS"__. ⚠️ **And because this and a rename
// are the same act, they call the same function** — so neither can move two places of three again.
export function openMoveAccount(state, from, redraw) {
  // ⚠️ AND NOT ITSELF — offering the name it is LEAVING as a destination is a press that can do
  // nothing, ⭐ **found by pressing it: the sheet listed "Loan" as somewhere to move Loan's own
  // records.**
  const targets = methodsOf(state).filter((m) => m !== from);
  showPopup(`Move what "${from}" holds`, (refresh, close) => [
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      `"${from}" is not one of your accounts any more, but records are still filed under it. Choosing an account moves every one of them onto it — orders, spending and money you put in alike.`),
    ...targets.map((m) => el("div", {
      class: "info-row tappable",
      onclick: () => {
        const n = moveAccountRecords(state, from, m);
        save(state);
        maybeSync(state);
        close();
        toast(`Moved ${n} ${n === 1 ? "record" : "records"} from ${from} to ${m}`);
        redraw();
      },
    },
      el("span", {}, m),
      el("span", { class: "info-val" }, el("span", { class: "muted" }, "move them here")))),
  ]);
}

// The one form. `current` is the label being changed, or "" for a new entry. Returns
// the field; `onDone(label)` runs after a successful save (the label, so a caller can
// select it), and `onDone("")` after a delete.
export function entryForm(state, { kind, current = "", onDone }) {
  const isCategory = kind === "category";
  // ★ WHERE HER MONEY CAME FROM (v394) — the third list, edited by this same form.
  const isSource = kind === "source";
  // All three lists read as { label, cls }: methods and sources are plain strings, and the
  // category-only `cls` is what tells the statement where a cost belongs.
  const list = isCategory ? categoriesOf(state)
    : isSource ? sourcesOf(state).map((m) => ({ label: m, cls: "" }))
      : methodsOf(state).map((m) => ({ label: m, cls: "" }));
  const existing = list.find((c) => c.label === current);
  const others = list.filter((c) => c.label !== current).map((c) => c.label);

  const name = el("input", { class: "input", value: current,
    placeholder: isCategory ? "e.g. Pet expo" : isSource ? "e.g. Maybank savings" : "e.g. Bank OD",
    "aria-label": "Name" });
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
    } else if (isSource) {
      // ⚠️ RENAMING MOVES WHAT SHE HAS ALREADY RECORDED WITH IT — the same rule the other two lists keep,
      // and the reason this is not merely cosmetic: a row stores the words it was written with, so a
      // rename that only changed the list would split her history across two spellings of one pot.
      state.settings.sources = current
        ? list.map((c) => (c.label === current ? label : c.label))
        : [...list.map((c) => c.label), label];
      if (current && current !== label) rewrite(state, "deposits", "source", current, label);
    } else {
      state.settings.payMethods = current
        ? list.map((c) => (c.label === current ? label : c.label))
        : [...list.map((c) => c.label), label];
      // ⚠️⚠️ ALL THREE PLACES, THROUGH THE ONE FUNCTION (v486). It used to call `rewrite` twice and
      // **never touched the orders** — see `moveAccountRecords`.
      if (current && current !== label) moveAccountRecords(state, current, label);
    }
    save(state);
    maybeSync(state);
    toast(current ? "Updated" : (isCategory ? "Category added" : isSource ? "Source added" : "Added"));
    if (onDone) onDone(label);
  };

  // ⚠️ ONE DELETE DOOR (v481): the line's own Delete button and this form's call the same function,
  // so the guard, the confirmation and the rule about rows already recorded cannot drift apart.
  const remove = () => removeEntry(state, { kind, current, onDone });

  return el("div", { class: "entry-form" },
    el("p", { class: "card-sub", style: "margin:0 0 6px" },
      isCategory
        ? "What an expense was for. Its kind tells the Profit statement where it belongs; renaming it moves what you have already recorded with it."
        : isSource
          ? "Where your own money came from. ⚠️ A different question from how it was paid in — money can come from your savings and still go in as cash. Renaming it moves what you have already recorded with it."
          : "How the money moved. Every account you add here is offered on the order's Pay press and gets its own block on the Money screen. Cash and TNG are the two you count by hand — your tin and your phone."),
    name,
    isCategory ? clsPills : null,
    el("div", { class: "btn-row", style: "margin-top:8px" },
      // ⭐ THE ESCAPE HATCH, WHERE SHE IS STANDING (v487). If this name has records it cannot be
      // deleted — ⭐ **so the form that would delete it is the form that must offer to move them.**
      current && !isCategory && !isSource && recordsUsing(state, kind, current)
        ? button("Move its records…", () => openMoveAccount(state, current, () => { if (onDone) onDone(null); }), "ghost small")
        : null,
      current ? button("Delete", remove, "danger small") : null,
      button("Cancel", () => { if (onDone) onDone(null); }, "ghost"),
      button(current ? "Save" : "Add", commit, "primary")));
}

// The ＋ chip that sits at the end of a row of pills, or under a list. Tapping it
// calls `open()`; the caller shows the inline form wherever it belongs.
export function newEntryChip(kind, open) {
  const text = kind === "category" ? "＋ New category"
    : kind === "source" ? "＋ New source"
      : "＋ New way to pay/receive";
  return button(text, open, "ghost small");
}
