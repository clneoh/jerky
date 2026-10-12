// test/money-lists.test.js — the two lists are hers to shape (v106+), and they are
// edited WHERE THE MONEY IS, not in a separate Settings card (16 Sep 2026: "dont put
// the setting separately, it should be at where it suppose to be"). So this drives
// the Money screen: the line under the cards, the list it opens, and the ＋ chip on
// the expense form. Renaming is the one that touches data — a row stores the words it
// was written with — so that is pinned extra hard.

import { test } from "node:test";
import assert from "node:assert/strict";

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    _classes: new Set(), style: {}, value: "", checked: false, disabled: false, hidden: false,
    _listeners: {}, parentElement: null, _rect: null,
    // ⚠️⚠️ THE DRAG READS THE DOM BACK, SO THESE HAVE TO BE REAL (v477). `wireRowReorder` asks
    // `classList.contains(...)`, moves the dragged node with `insertBefore`, reads `children` off the
    // box it was given, and measures every row's rect. A shim that could not answer those would
    // report every drag as a no-op — and a no-op still passes. ⭐ `classList` is now backed by the
    // same `className`, so a row written with `{ class: "info-row" }` really does answer
    // `contains("money-list-row")`; before this it answered from a set nothing ever wrote to.
    appendChild(c) {
      if (c == null) return c;
      if (c.parentElement) c.parentElement.children = c.parentElement.children.filter((x) => x !== c);
      c.parentElement = this;
      this.children.push(c);
      return c;
    },
    insertBefore(c, ref) {
      if (c == null) return c;
      if (c.parentElement) c.parentElement.children = c.parentElement.children.filter((x) => x !== c);
      c.parentElement = this;
      const at = ref == null ? this.children.length : this.children.indexOf(ref);
      this.children.splice(at < 0 ? this.children.length : at, 0, c);
      return c;
    },
    append(...cs) { for (const c of cs) this.appendChild(c); },
    // ⚠️⚠️ THIS SHIM WAS MORE FORGIVING THAN THE BROWSER, AND IT HID A REAL FAULT (v404).
    // It **skipped** a null child. The DOM does not: `replaceChildren` takes nodes *or strings*, so a
    // `null` is converted with `String()` and **prints the word "null" on her screen**. The Money
    // screen's window stepper read *"Week of 4 Oct – 10 Oct  null"* whenever the forward arrow was
    // absent, and this shim drew a clean row — found by LOOKING at 375px, not by any test.
    // ⭐ `el()` DOES skip nulls (that is why most of the app is safe); **`replaceChildren` does not.**
    // A stand-in that cannot express what the browser does is the stand-in that is wrong.
    replaceChildren(...cs) {
      for (const c of this.children) if (c && c.parentElement === this) c.parentElement = null;
      this.children = [];
      for (const c of cs) {
        if (c == null) this.children.push({ nodeType: 3, text: String(c) });
        else this.appendChild(c);
      }
    },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === "hidden") this.hidden = true; },
    getAttribute(k) { return this.attrs[k]; },
    focus() {}, click() {},
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect() {
      return this._rect || { top: 0, left: 0, right: 300, bottom: 60, width: 300, height: 60 };
    },
    get nextElementSibling() {
      const p = this.parentElement;
      if (!p) return null;
      return p.children[p.children.indexOf(this) + 1] || null;
    },
    get classList() {
      const self = this;
      return {
        add(...cs) { for (const c of cs) self._classes.add(c); },
        remove(...cs) { for (const c of cs) self._classes.delete(c); },
        contains(c) { return self._classes.has(c); },
        toggle(c, on) {
          if (on === undefined) { if (self._classes.has(c)) self._classes.delete(c); else self._classes.add(c); }
          else if (on) self._classes.add(c);
          else self._classes.delete(c);
        },
      };
    },
  };
  Object.defineProperty(node, "className", {
    get() { return [...node._classes].join(" "); },
    set(v) { node._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    enumerable: true,
  });
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  return node;
}
const registry = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: createEl("body"),
};
globalThis.window = { open() {} };
globalThis.location = { hash: "#/money", reload() {} };
globalThis.history = { replaceState() {} };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.fetch = async () => ({ ok: true, json: async () => [] });

const { renderMoney } = await import("../admin/js/views/money.js");
const { entryForm } = await import("../admin/js/views/accountsEditor.js");
const { categoriesOf, classOfCategory, methodsOf } = await import("../admin/js/accounts.js");
const { weekStartISO } = await import("../admin/js/weekly.js");
const { todayISO, longDate } = await import("../admin/js/dates.js");

function freshState() {
  return {
    version: 1,
    settings: { currency: "RM", categories: [], payMethods: [] },
    products: [], ingredients: [], suppliers: [], uoms: [], deliveryDates: [], orders: [],
    customers: [], purchaseOrders: [], expenses: [], deposits: [], credits: [], occasions: [],
  };
}
const walk = (n, out = []) => {
  for (const c of n.children || []) { out.push(c); walk(c, out); }
  return out;
};
// A click carrying an event: the ✕ inside an editable row stops the tap from reaching
// the row beneath it, so its handler expects one.
const fire = (node, ev = { stopPropagation() {} }) =>
  (node._listeners.click || []).forEach((f) => f(ev));
const byText = (root, text) =>
  walk(root).find((n) => n.tagName === "BUTTON" && n.textContent.trim() === text);
// The line for `label`. ⚠️ FOUND BY ITS NAME, NOT BY `children[0]` — the first child has been the
// drag grip since v477, and a finder keyed to a child's POSITION is one that breaks the next time a
// row gains something at its head. It broke in exactly that way when the grip arrived.
const managerRow = (label) => walk(registry["popup-layer"])
  .filter((n) => String(n.className).includes("info-row"))
  .find((r) => r.children.some((c) => String(c.className).includes("money-list-name") && c.textContent === label));
// What a line says beside the name — its own class rather than a position, for the same reason.
const rowNote = (row) => row.children.find((c) => String(c.className).includes("info-val"));

// ⚠️ THE LINE IS NO LONGER A BUTTON (v481) — it carries its own Edit and Delete, like every other list
// in the app, because a row that LOOKS like text was not an affordance: she had to ask twice how to
// delete an account. So a test opens one the way she does.
const allOfText = (n, out = []) => { let t = String(n.textContent || "");
  for (const c of n.children || []) t += " " + allOfText(c, out); return t; };
const rowName = (row) => (row.children.find((c) => String(c.className).includes("money-list-name")) || {}).textContent;
// The entry form's own box — by its label, not simply the first input, because the
// expense form behind it has an amount box of its own.
const editorBox = () => walk(registry["popup-layer"])
  .find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "Name");

function mount(state) {
  const root = createEl("div");
  renderMoney(root, state);
  return root;
}
// Open the manager from the Money screen's own line.
function openManager(state) {
  const root = mount(state);
  fire(byText(root, "Edit"));
  return root;
}

test("the Money screen says what the lists hold, and a loan is among them", () => {
  // ⚠️ THE TITLE NAMES ALL THREE LISTS NOW (v394). It read "Categories & ways to pay", which stopped
  // being true the moment a third list joined them — **and a heading missing one of the things under
  // it is how she fails to find that thing.**
  const root = mount(freshState());
  const line = walk(root).find((n) => (n.children || []).some((c) => String(c.className).includes("card-title")
    && c.textContent === "Categories, way to pay/receive & sources"));
  assert.ok(line, "the lists are on the money screen, not tucked away in Settings");
  assert.match(line.textContent, /11 categories/);
  assert.match(line.textContent, /Cash, TNG, Loan/, "with the third choice she asked for");
  assert.match(line.textContent, /2 sources/, "⚠️ and the third list is not mentioned at all");
});

test("Edit opens the lists, and every line can be opened to change it", () => {
  const state = freshState();
  openManager(state);
  const listed = walk(registry["popup-layer"]).filter((n) => String(n.className).includes("info-row"));
  const names = listed.map(rowName);
  assert.ok(names.includes("Rent") && names.includes("Salary (you)"), "the chart, by name");
  assert.ok(names.includes("Cash") && names.includes("TNG") && names.includes("Loan"), "and the ways to pay");
  // ⚠️⚠️ AND THE OLD NOTE IS GONE BECAUSE THE SPLIT IT DESCRIBED IS GONE (v481). It said a loan was
  // "not from the purse" / "not in your purse or phone" — ⭐ **which said the loan was not an
  // account at all**, and that is precisely what she asked me to unify. Every one of them is an
  // account now, so a loan says so, and Cash and TNG are named for where they are.
  // ⚠️⚠️ AND THE NOTES ARE GONE (v483). Her words: __"i dont need the word your tin, your phone"__ — and
  // the whole column went with them, because leaving "an account" on some lines and nothing on others
  // is worse than either. ⭐ **An account's name is the whole of what its line says.**
  assert.equal(rowNote(managerRow("Loan")).textContent.trim(), "",
    "no note on a loan's line — its name is the whole of it");
  assert.equal(rowNote(managerRow("Cash")).textContent.trim(), "",
    "and none on Cash either");
  // ⚠️⚠️ AND THE AFFORDANCE IS VISIBLE NOW (v481). The row used to be `tappable` with the word "edit"
  // in grey at its end — ⭐ **which she had to ask about TWICE.** It carries its own Edit and
  // Delete, the same two buttons every other list in this app wears.
  assert.ok(byText(managerRow("Rent"), "Edit") && byText(managerRow("Rent"), "Delete"),
    "a line carries its own Edit and Delete, not a secret tap");
  assert.ok(!String(managerRow("Rent").className).includes("tappable"),
    "and it is not a press as well as a drag — the grip can never be mistaken for one");
});

test("renaming a category moves what was already recorded under it", () => {
  const state = freshState();
  state.expenses = [{ id: "e1", date: "2026-09-10", amount: 18, category: "Packaging" }];
  openManager(state);
  fire(byText(managerRow("Packaging"), "Edit"));

  const box = editorBox();
  assert.equal(box.value, "Packaging", "open on the name being changed");
  box.value = "Packing";
  fire(byText(registry["popup-layer"], "Save"));

  assert.ok(state.settings.categories.some((c) => c.label === "Packing"));
  assert.ok(!state.settings.categories.some((c) => c.label === "Packaging"));
  assert.equal(state.expenses[0].category, "Packing",
    "her history moved with the name instead of splitting in two");
});

test("renaming a way to pay moves its entries, in and out", () => {
  const state = freshState();
  state.expenses = [{ id: "e1", date: "2026-09-10", amount: 250, category: "Ingredients & shopping", method: "Loan" }];
  state.deposits = [{ id: "d1", date: "2026-09-09", amount: 100, method: "Loan" }];
  // ⚠️⚠️ AND AN ORDER — THE PLACE A RENAME MISSED FOR MONTHS (v486).
  state.orders = [{ id: "o1", qty: 1, productId: "p1", status: "ready", paidReceived: true,
    paidMethod: "Loan", deliveryDateId: "d1" }];
  openManager(state);
  fire(byText(managerRow("Loan"), "Edit"));
  editorBox().value = "Bank OD";
  fire(byText(registry["popup-layer"], "Save"));

  assert.ok(state.settings.payMethods.includes("Bank OD"));
  assert.equal(state.expenses[0].method, "Bank OD", "the spending follows");
  assert.equal(state.deposits[0].method, "Bank OD", "and so does the money that came in");
  // ⚠️⚠️ THE THIRD PLACE, WHICH IT NEVER MOVED. A method is written on an order too, and rewriting
  // two of three leaves the orders filed under a name that is no longer on her list — ⭐ **which is
  // exactly the "Cash" block she asked about three times, holding RM 64 of stranded orders.**
  assert.equal(state.orders[0].paidMethod, "Bank OD",
    "⚠️⚠️ the ORDERS move with the rename — the place that was left behind");
});

test("⚠️⚠️ Cash and TNG cannot be deleted — the books are built on them (v487)", () => {
  // Her words: __"lock cash and TNG from deletion"__. ⭐ **`isCash` / `isTng` are exact matches on those
  // two words**, and the tin figure and the phone figure are built on them — ⚠️ **delete one and no
  // account is left that a new order can be recorded as cash with.** She had already been burnt by
  // exactly that once today: the "Cash" block holding RM 64 she asked about three times.
  const state = freshState();
  openManager(state);

  assert.ok(!byText(managerRow("Cash"), "Delete"), "⚠️ no Delete on Cash — the tin is built on it");
  assert.ok(!byText(managerRow("TNG"), "Delete"), "⚠️ and none on TNG — the phone is built on it");
  assert.ok(byText(managerRow("Loan"), "Delete"), "⭐ while every other account keeps its Delete");
  // ⚠️ AND THEY CAN STILL BE RENAMED — which since v486 moves every record with it, so there is
  // nothing a delete was needed for.
  assert.ok(byText(managerRow("Cash"), "Edit"), "and both can still be renamed");

  // ⚠️⚠️ AND THE GUARD IS BEHIND THE MISSING BUTTON, NOT REPLACED BY IT. The form the Edit button
  // opens carries a Delete of its own, and pressing it must refuse.
  fire(byText(managerRow("Cash"), "Edit"));
  const del = byText(registry["popup-layer"], "Delete");
  assert.ok(del, "the form still offers a Delete, so the guard has to hold");
  fire(del);
  assert.ok(state.settings.payMethods.length === 0 || state.settings.payMethods.includes("Cash"),
    "⚠️ Cash survived the form's own Delete — the guard is real, not just a hidden button");
});

test("★★ a list entry a transaction uses CANNOT be deleted — her base rule (v487)", () => {
  // ⭐ HER WORDS, AND THEY ARE THE BASE RULE THE APP SHOULD ALWAYS HAVE KEPT: __"whatever already have
  // transaction cannot be delete that is the base rules right?"__
  //
  // ⚠️⚠️ THE APP USED TO DO THE OPPOSITE: it deleted the entry and KEPT the records under the old name.
  // ⭐ **That is exactly the "Cash" block holding RM 64 she asked about three times** — the account went,
  // the transactions stayed, and the block sat there with no way back. ⭐ **She should never have been
  // able to do it, and now she cannot.**
  const state = freshState();
  state.expenses = [{ id: "e1", date: "2026-09-10", amount: 30, category: "Utilities" }];
  openManager(state);
  fire(byText(managerRow("Utilities"), "Delete"));
  // ⚠️⚠️ AND PRESS THE CONFIRMATION **IF ONE APPEARED**. ⭐ The guard refuses BEFORE the confirm, so
  // with the rule on there is nothing to press — ⚠️ **and with it off, the confirm opens and the
  // delete goes through. Without this line the test passed either way, reading a list nothing had
  // touched: the same trap the OLD test sat in.**
  const yes = byText(registry["confirm-layer"], "Delete");
  if (yes) fire(yes);

  // ⚠️⚠️ AND READ THE LIST THE APP DRAWS, NOT THE STORED ARRAY. `freshState` leaves
  // `settings.categories` EMPTY — the built-in ones come from `categoriesOf` — so an assertion on
  // the stored array passes whatever happened, ⭐ **which is exactly how the OLD test went on saying
  // "gone from the list" for years while reading a list that was never there.**
  assert.ok(categoriesOf(state).some((c) => c.label === "Utilities"),
    "⚠️⚠️ Utilities is USED by an expense, so it cannot go — and it did not");
  assert.equal(state.expenses[0].category, "Utilities", "and the record is untouched, because nothing happened");

  // ⭐ AND ONE NOTHING USES STILL GOES, because the rule is about RECORDS and not about a list.
  const free = freshState();
  openManager(free);
  fire(byText(managerRow("Utilities"), "Delete"));
  fire(byText(registry["confirm-layer"], "Delete"));
  assert.ok(!categoriesOf(free).some((c) => c.label === "Utilities"),
    "nothing used it, so it goes exactly as before");
});


test("a way to pay can be added, and the last one cannot be deleted", () => {
  const state = freshState();
  const root = mount(state);
  fire(byText(root, "Edit")); // the lists
  fire(byText(registry["popup-layer"], "＋ New way to pay/receive"));
  editorBox().value = "Bank OD"; // the form opens in place, under the list
  fire(byText(registry["popup-layer"], "Add"));
  assert.equal(state.settings.payMethods.at(-1), "Bank OD", "added to the list");
  assert.equal(state.settings.payMethods.length, 4, "beside the three that were there");

  // Down to one, and the last cannot be removed: there must always be a way to pay.
  state.settings.payMethods = ["Cash"];
  const one = entryForm(state, { kind: "method", current: "Cash" });
  fire(byText(one, "Delete"));
  assert.deepEqual(state.settings.payMethods, ["Cash"], "kept — there is always a way to pay");
  assert.equal(walk(registry["confirm-layer"]).length, 0,
    "and it does not even open a confirm box: there is nothing she could confirm");
});

test("the expense form can add a category without leaving the form", () => {
  const state = freshState();
  const root = mount(state);
  fire(byText(root, "＋ Add an expense"));
  const form = registry["popup-layer"];
  const typed = walk(form).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "Amount");
  typed.value = "30"; // half-typed spending, which must survive
  fire(byText(form, "＋ New category"));

  // The form opens IN PLACE — a pop-up from inside a pop-up would wipe the expense
  // she is part-way through (the app has one shared layer).
  const box = editorBox();
  assert.ok(box, "the small form opens inside the expense form");
  box.value = "Baking class";
  fire(byText(form, "A running cost"));
  fire(byText(form, "Add"));

  assert.equal(state.settings.categories.at(-1).label, "Baking class");
  assert.equal(state.settings.categories.at(-1).cls, "expense");
  const again = walk(registry["popup-layer"]);
  assert.equal(again.find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "Amount").value, "30",
    "what she had typed is still there");
  const picked = again.filter((n) => String(n.className).includes("cal-mode-on")).map((b) => b.textContent.trim());
  assert.ok(picked.includes("Baking class"), "and the new category comes back picked, so she can carry on");
});

// ── ★★ the third list: where her own money came from (v394) ───────────────────
// Her words, looking at the Put money in form: __"should have additional field : from xxx"__ — and,
// asked whether it should be typed or picked, __"Which pot it came from — picked"__.

test("★★ the sources list is on the screen she edits the other two on", () => {
  const state = freshState();
  openManager(state);
  const names = walk(registry["popup-layer"])
    .filter((n) => String(n.className).includes("info-row"))
    .map(rowName);
  assert.ok(names.includes("My own pocket") && names.includes("Savings"),
    "⚠️ the third list is not on the screen she edits the other two on");
});

test("★★ renaming a source moves the money-in rows already recorded under it", () => {
  // ⚠️ A row stores the words it was WRITTEN with, so a rename that only changed the list would split
  // her history across two spellings of one pot — the rule the other two lists already keep.
  const state = freshState();
  state.deposits = [{ id: "d1", date: "2026-09-10", amount: 50, method: "Cash", source: "Savings" }];
  openManager(state);
  fire(byText(managerRow("Savings"), "Edit"));
  editorBox().value = "Maybank savings";
  fire(byText(registry["popup-layer"], "Save"));
  assert.equal(state.deposits[0].source, "Maybank savings",
    "⚠️ renaming the pot left the rows she recorded under it on the old name");
});

test("⚠️ the pot she picks on the money-in form is saved onto the row", () => {
  const state = freshState();
  const root = mount(state);
  fire(byText(root, "＋ Put money in"));
  const layer = registry["popup-layer"];
  walk(layer).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "How much you put in").value = "200";
  fire(byText(layer, "Savings"));
  fire(byText(layer, "Save"));
  assert.equal(state.deposits.length, 1, "the money-in row was not written");
  assert.equal(state.deposits[0].source, "Savings", "⚠️ the pot she picked was not saved on the row");
});

// ── ★★ moving money between her own pots (v395) ───────────────────────────────
// Her words: __"if its for sometimes we want to transfer money from tnG to cash, or to bank"__.

test("★★ a transfer writes BOTH sides — out of one pot and into the other", () => {
  // ⚠️⚠️ ONE SIDE ALONE IS THE WHOLE FAULT: a deposit on its own would count her own RM200 as money
  // IN, and moving money between two pockets of hers would inflate the figures she reads her takings
  // from. The two rows are what make it a movement rather than new money.
  const state = freshState();
  const root = mount(state);
  fire(byText(root, "⇄ Transfer"));
  const layer = registry["popup-layer"];
  walk(layer).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "How much you moved").value = "200";
  fire(byText(layer, "Save"));

  assert.equal(state.expenses.length, 1, "nothing left the pot it came from");
  assert.equal(state.deposits.length, 1, "the money never arrived in the other pot");
  assert.equal(state.expenses[0].method, "Cash", "the out-side is not out of the pot it came from");
  assert.equal(state.deposits[0].method, "TNG", "the in-side did not land in the other pot");
  assert.equal(state.deposits[0].source, "Cash", "the row does not say where the money came from");
  assert.equal(state.deposits[0].transfer, true, "so it would read as money arriving from outside");
  // ⚠️⚠️ AND IT IS NOT A COST. An ordinary category would put moving her own money on the profit
  // statement as a cost of trading — which is why the out-side goes under the DRAWINGS category, the
  // same thing `Pay back a pocket` does and for the same reason.
  assert.equal(classOfCategory(state, state.expenses[0].category), "drawing",
    "⚠️ a transfer put a cost on the profit statement");
});

test("★★ the net does not move when money moves between her own pots", () => {
  // ⚠️ THE ROWS ARE TWO SHAPES NOW (v481): an account block (name, where it is, three figures) and
  // the summary rows below them. ⭐ And the total is named for what it is — "Net — every account" —
  // because it no longer means the tin and the phone.
  const netOf = (s) => {
    const rows = walk(mount(s)).filter((n) => String(n.className).includes("info-row"));
    return rows.find((r) => r.children[0].textContent === "Net — every account").children[1].textContent;
  };
  // ⭐ The block is four COLUMNS now (v482) — the account, then In, Out and Holds — so this reads all
  // three figures rather than the first.
  const cashOf = (s) => {
    const r = walk(mount(s))
      .filter((n) => String(n.className).includes("acc-row")
        && !String(n.className).includes("acc-head-row"))
      .find((x) => x.children[0].children[0].textContent === "Cash");
    return [1, 2, 3].map((i) => r.children[i].textContent).join("|");
  };
  const state = freshState();
  const before = netOf(state);

  const root = mount(state);
  fire(byText(root, "⇄ Transfer"));
  const layer = registry["popup-layer"];
  walk(layer).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "How much you moved").value = "200";
  fire(byText(layer, "Save"));

  assert.equal(cashOf(state), "RM 0.00|RM 200.00|RM -200.00",
    "the account it came out of went down, and its block says so");
  assert.equal(netOf(state), before,
    "⚠️⚠️ moving her own money changed what should be with her — nothing entered or left the business");
});

test("⚠️ the transfer cannot pick the SAME pot on both sides", () => {
  const state = freshState();
  const root = mount(state);
  fire(byText(root, "⇄ Transfer"));
  const layer = registry["popup-layer"];
  walk(layer).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "How much you moved").value = "200";
  // From defaults to Cash; the first pill of each row is Cash, so pressing both "To"s second pill
  // is not enough — drive it through the documented rule instead: picking the pot already chosen on
  // the other side must not leave a double.
  const pills = walk(layer).filter((n) => n.tagName === "BUTTON" && n.textContent.trim() === "Cash");
  fire(pills[pills.length - 1]); // pick Cash as the destination too
  fire(byText(layer, "Save"));
  assert.notEqual(state.expenses.length && state.expenses[0].method,
    state.deposits.length && state.deposits[0].method,
    "⚠️ a transfer to the same pot went through — that is not a movement at all");
});

test("★★ the Money screen carries her investment as its own account", () => {
  // ⚠️ Her words: __"we are able to generate investment account.?"__ — and it must name BOTH sides, or
  // it answers only half of what she asked for.
  const state = freshState();
  state.deposits = [{ id: "d1", date: "2026-09-01", amount: 500, method: "Cash" }];
  state.expenses = [{ id: "e1", date: "2026-09-10", amount: 50,
    category: "My own withdrawal", method: "Cash" }];
  const root = mount(state);
  const line = walk(root).find((n) => (n.children || []).some((c) =>
    String(c.className).includes("card-title") && c.textContent === "Your investment"));
  assert.ok(line, "⚠️ her investment is not on the Money screen at all");
  assert.match(line.textContent, /Put in RM 500\.00/, "the money she put in is not named");
  assert.match(line.textContent, /taken back RM 50\.00/, "⚠️ money taken back out is not named");
  assert.match(line.textContent, /all time/, "⚠️ and nothing says it is a balance, not this stretch");
});

// ── ★★ whose money paid for it (v397) ─────────────────────────────────────────
// Her words: __"When i enter an expenses, like buying equipment, should i allow to credit investment
// account?"__ — and, asked how the app should tell the two apart, she chose to say so on the expense.

test("★★ the expense form asks whose money paid — and only when a POCKET did", () => {
  const state = freshState();
  const root = mount(state);
  fire(byText(root, "＋ Add an expense"));
  const layer = registry["popup-layer"];
  walk(layer).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "Amount").value = "500";

  // ⚠️ Cash paid, so the till's own money is in question — nothing is owed and nothing is invested.
  assert.equal(byText(layer, "It is my investment"), undefined,
    "⚠️ she is being asked whose money paid when the till paid it");

  // Pay from one of her own pockets and the question appears.
  fire(byText(layer, "Loan"));
  assert.ok(byText(layer, "It is my investment"),
    "⚠️ paying from her own pocket asks nothing about whose money it was");
  // ⚠️ ASSERTION ON USER-VISIBLE COPY, so it moves with the string: jerky says "the business".
  assert.ok(byText(layer, "The business owes me"), "and the debt it already was must still be offered");

  fire(byText(layer, "It is my investment"));
  fire(byText(layer, "Save"));
  assert.equal(state.expenses.length, 1);
  assert.equal(state.expenses[0].invested, true, "⚠️ the choice she made was not saved on the row");
});

test("★★ a withdrawal asks WHOSE investment it comes out of — an ordinary cost does not", () => {
  // ⚠️ Only a withdrawal reduces somebody's share of the bakery. An ordinary cost is not anyone's money
  // going back to them, so the question must not be put to it.
  const state = freshState();
  const root = mount(state);
  fire(byText(root, "＋ Add an expense"));
  const layer = registry["popup-layer"];
  walk(layer).find((n) => n.tagName === "INPUT" && n.attrs["aria-label"] === "Amount").value = "300";

  assert.equal(byText(layer, "My own pocket"), undefined,
    "⚠️ an ordinary cost is being asked whose investment it comes out of");

  fire(byText(layer, "My own withdrawal"));
  assert.ok(byText(layer, "My own pocket"),
    "⚠️ taking her own money out asks nothing about whose it is — no owner's balance can be right");

  fire(byText(layer, "Savings"));
  fire(byText(layer, "Save"));
  assert.equal(state.expenses.length, 1);
  assert.equal(state.expenses[0].source, "Savings",
    "⚠️ the owner she picked was not saved on the withdrawal");
});

// ── ★★ Money's week is the SUNDAY one now (v403) ──────────────────────────────
test("★★ Money's 'A week' is the SAME week Home and the invoice use — Sunday first", () => {
  // ⚠️⚠️ MONEY WAS THE ONLY SCREEN USING A MONDAY WEEK. Home's "This week" tile and the invoice's
  // "A week" both start on **Sunday** (`weekStartISO`), so the app offered two different windows under
  // one name. Her call, asked which to use: __"Sunday, to match the rest"__.
  // ⭐ The test is written against the shared builder's own answer rather than a hand-computed date, so
  // it cannot drift from `periodSpan` the way a second week rule would.
  const state = freshState();
  const root = mount(state);
  const week = walk(root).find((n) => n.tagName === "BUTTON" && n.textContent.trim() === "A week");
  assert.ok(week, "the week choice is not offered");
  fire(week);
  const label = walk(root).find((n) => String(n.className).includes("range-label")).textContent;
  const sunday = weekStartISO(todayISO());
  assert.ok(label.includes(longDate(sunday)),
    `⚠️ Money's week does not start on Sunday: ${label} — Home and the invoice start ${longDate(sunday)}`);
});

// ── ★★⚠️ nothing on this screen ever prints the word "null" (v404) ─────────────
test("★★⚠️ the window stepper never prints the word 'null' — the arrow that is absent is ABSENT", () => {
  // ⚠️⚠️ FOUND BY LOOKING, NOT BY A TEST. The stepper is built with `replaceChildren`, and **a `null`
  // handed to it is a node-or-string argument — the DOM converts it with `String()` and renders the
  // word "null"**. The screen read *"Week of 4 Oct 2026 – 10 Oct 2026  null"* whenever the forward
  // arrow was absent, which is the CURRENT period — i.e. the state it opens in.
  // ⭐ `el()` skips a null child; `replaceChildren` does not. This shim was made as unforgiving as the
  // browser for exactly this, so the fault could not hide behind it again.
  const state = freshState();
  const root = mount(state);
  // ⚠️⚠️ THE MODE IS SET EXPLICITLY, AND THAT IS NOT TIDINESS — IT IS THE TEST WORKING AT ALL.
  // `range` and `anchor` are MODULE scope, so an earlier test in this file leaves them wherever it
  // finished; the first version of this test then ran on whatever window that was, **never took the
  // arrow-absent branch, and passed while the fault sat in the code.** A guard that depends on the test
  // order before it is not a guard.
  const day = walk(root).find((n) => n.tagName === "BUTTON" && n.textContent.trim() === "A day");
  fire(day);
  assert.ok(!/null/.test(root.textContent),
    "⚠️⚠️ the word 'null' is on her screen — an absent arrow was passed to replaceChildren as a node");

  // ⚠️ AND EVERY mode, not just the one it opens on: "All" has BOTH arrows absent, which is the other
  // way to hand this builder two nulls in a row.
  const all = walk(root).find((n) => n.tagName === "BUTTON" && n.textContent.trim() === "All");
  fire(all);
  assert.ok(!/null/.test(root.textContent), "⚠️ the word 'null' appears on the All window");
});

// ── ★★ THE HANDLE (v477) ─────────────────────────────────────────────────────
//
// Her words: __"make me a handle, and the handle rule is a universal one."__ ⭐ The rule is the one
// she gave for the shelves — **what she repositions with the handle, every drop-down that offers it
// follows** — and on these three lists it holds for free, because the ORDER IS THE ARRAY that
// `categoriesOf` / `methodsOf` / `sourcesOf` hand back. So these pin the two halves that could drift:
// the grip being on every line, and the drag writing the whole list in her order.

const listRows = () => walk(registry["popup-layer"])
  .filter((n) => String(n.className).includes("money-list-row"));
const gripOf = (row) => row.children.find((c) => String(c.className).includes("money-handle"));

// Give every line the geometry a phone would: 60px tall, 80px apart down the page. The drag measures
// against these and nothing else, so only the GAPS matter and not which index a line happens to be.
const lay = (rows, top = 0, height = 60, gap = 80) => {
  rows.forEach((n, i) => {
    n._rect = { top: top + i * gap, left: 0, width: 300, height, bottom: top + i * gap + height, right: 300 };
  });
};
// One press, one move, one release on a line's grip.
function dragLine(row, dy) {
  const handle = gripOf(row);
  const base = row._rect.top;
  handle._listeners.pointerdown[0]({ button: 0, pointerId: 1, clientX: 10, clientY: base + 10, preventDefault() {} });
  handle._listeners.pointermove[0]({ pointerId: 1, clientX: 10, clientY: base + 10 + dy });
  handle._listeners.pointerup[0]({ pointerId: 1 });
}
// A click travelling from the grip UP to the line, the way the browser delivers it. ⚠️ FIRING THE
// LINE'S OWN HANDLER WOULD PASS WHETHER THE GUARD EXISTED OR NOT, because the guard IS a
// `stopPropagation` on the grip — a test that skips the bubbling tests nothing.
function clickThrough(chain) {
  const ev = { stopped: false, stopPropagation() { this.stopped = true; } };
  for (const n of chain) {
    for (const f of n._listeners.click || []) f(ev);
    if (ev.stopped) return false;
  }
  return true;
}

test("★★ every line of all three lists carries a handle, and the one being edited does not", () => {
  const state = freshState();
  openManager(state);
  const rows = listRows();
  assert.ok(rows.length >= 16, "the three lists are all on this screen");
  const bare = rows.filter((r) => !gripOf(r));
  assert.equal(bare.length, 0, "⚠️ a line with no handle is a line she cannot arrange");
  assert.ok(rows.every((r) => gripOf(r).attrs.title === "Drag to reorder"),
    "⚠️ and the grip says what it is for");

  // ⚠️ THE LINE BEING EDITED IS NOT A DRAGGED LINE. The editor REPLACES the line, so an open form
  // cannot be picked up and dropped somewhere else — the same reason the Categories screen leaves the
  // heading out of its reachable rows.
  const before = rows.length;
  fire(byText(managerRow("Loan"), "Edit"));
  assert.equal(listRows().length, before - 1,
    "⚠️ the line she opened is still draggable — an open form must never be picked up");
});

test("★★ dragging a way to pay writes HER order onto the list itself", () => {
  const state = freshState();
  assert.deepEqual(state.settings.payMethods, [], "the list is not in her settings yet");
  openManager(state);
  lay(listRows());
  dragLine(managerRow("Cash"), 200);
  assert.deepEqual(state.settings.payMethods, ["TNG", "Loan", "Cash"],
    "⚠️ the built-in list is now WRITTEN OUT in her order — a drag that only moved the picture "
    + "would be undone by the next redraw");
});

test("★★ a drop lands only among its own list, and the page is not rebuilt under her", () => {
  const state = freshState();
  openManager(state);
  lay(listRows());
  const cash = managerRow("Cash");
  // ⚠️ ONE SLOT DOWN, AND THE ANSWER DEPENDS ENTIRELY ON THE `kin` GUARD. Read against EVERY row on
  // the screen instead, the eleven categories above it all sit closer to the pointer than TNG does,
  // and Cash would be sent to the far end of the list. A sideways drop that read as "make this a
  // category" is a rule she would have to be taught — the same reason the Categories screen holds a
  // drop among brothers.
  dragLine(cash, 80);
  assert.deepEqual(state.settings.payMethods, ["TNG", "Cash", "Loan"], "one slot down, among its own");
  assert.deepEqual(state.settings.categories, [], "and the chart is not touched");
  // ⚠️ NOT `deepEqual([])`: this fixture never had a sources list, and the point is that the drag
  // must not WRITE one either. Asserting on emptiness would pass for the wrong reason.
  assert.ok(!Array.isArray(state.settings.sources), "nor where her own money comes from");

  // Far past the bottom of the screen: still the end of its OWN list, not after the sources.
  lay(listRows());
  dragLine(managerRow("Cash"), 4000);
  assert.deepEqual(state.settings.payMethods, ["TNG", "Loan", "Cash"], "still among the ways to pay");
  // ⚠️ AND THE DRAGGED NODE IS STILL THE ONE ON THE PAGE. `wireRowReorder` moves it itself after
  // `onDrop` returns, so a rebuild here would replace every line and leave the drop half-done — and a
  // count of nodes would not have caught that, because a rebuild builds the same number of them.
  assert.ok(listRows().includes(cash),
    "⚠️⚠️ the line was replaced instead of moved — the redraw took the page's scroll with it");
});

test("★★ what she repositions is the order every picker then offers", () => {
  // ⚠️ THIS IS THE OTHER HALF OF HER RULE, AND IT IS THE HALF THAT HAS BROKEN BEFORE. The drag writes
  // the LIST; the readers hand that same list back in its own order — `methodsOf` to every drop-down
  // built from it, `categoriesOf` to the expense form, `sourcesOf` to the money-in form. So the thing
  // worth pinning is not "the list moved" but "the next thing that offers her accounts offers them in
  // her order".
  const state = freshState();
  openManager(state);
  lay(listRows());
  dragLine(managerRow("Cash"), 200);
  assert.deepEqual(methodsOf(state), ["TNG", "Loan", "Cash"],
    "⚠️ every drop-down built from `methodsOf` must now offer TNG, Loan, Cash — the order she set");
});

test("⚠️⚠️ the drag guard holds — a dragged row is never also a press", () => {
  // ⚠️⚠️ NO DRAGGED ROW IS TAPPABLE ANY MORE (v481). The money lines carry their own Edit and Delete
  // now — ⭐ **which she asked for twice** — so there is no press on them to swallow.
  // ⭐ **But the guard in `wireRowReorder` stays, because it is what protects any row that is ever both
  // again, and a guard nobody tests is a guard that rots.** ⚠️ So this pins the CONTRACT rather than
  // today's screen: a row given a press of its own must not receive one on a drop.
  const state = freshState();
  openManager(state);
  lay(listRows());
  const cash = managerRow("Cash");
  const pressed = [];
  cash._listeners.click = [() => pressed.push("row")]; // stand in for a tappable dragged row

  dragLine(cash, 200);
  const grip = gripOf(cash);
  assert.equal(clickThrough([grip, cash]), false,
    "⚠️⚠️ the click after a drop reached the row — a drag would fire whatever a press fires");
  assert.equal(clickThrough([grip, cash]), true,
    "⚠️ and the NEXT click must get through: a guard never cleared swallows the press after it");
  assert.equal(pressed.length, 1, "so the press she made afterwards reached the row, exactly once");

  // ⚠️ AND A CANCELLED DRAG MUST NOT SWALLOW THE TAP AFTER IT. `pointercancel` ends a gesture with no
  // click for the guard to consume, so the flag is left armed — and it is the NEXT pointerdown that
  // disarms it. ⭐ That is why the reset lives on the press and not in `finish()`: `finish()` runs
  // BEFORE the click arrives, so clearing it there would look tidier and would let every drop through.
  lay(listRows());
  const loan = managerRow("Loan");
  loan._listeners.click = [() => pressed.push("loan")];
  const grip2 = gripOf(loan);
  const base = loan._rect.top;
  grip2._listeners.pointerdown[0]({ button: 0, pointerId: 1, clientX: 10, clientY: base + 10, preventDefault() {} });
  grip2._listeners.pointermove[0]({ pointerId: 1, clientX: 10, clientY: base + 90 });
  grip2._listeners.pointercancel[0]({ pointerId: 1 });
  grip2._listeners.pointerdown[0]({ button: 0, pointerId: 1, clientX: 10, clientY: base + 10, preventDefault() {} });
  grip2._listeners.pointerup[0]({ pointerId: 1 });
  assert.equal(clickThrough([grip2, loan]), true,
    "⚠️ a cancelled drag left the guard armed and the tap after it was swallowed");
});
