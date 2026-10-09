// accounts.js — the three lists the books are built from, all of them hers to shape
// (16 Sep 2026; the third arrived at v394):
//
//   • CATEGORIES — what an expense was FOR. Each carries a class, which is what the
//     profit and loss account needs to know: "stock" (ingredients, costed through
//     the recipes), "expense" (a running cost), "drawing" (her money back out).
//   • METHODS — HOW money moved. Cash and TNG are the two a customer uses; Loan and
//     Bank OD are ways of paying for things with money that is not in the till.
//   • SOURCES — WHERE her own money came from, on the Put money in form. ⚠️ A
//     different question from METHODS, and a row carries both (see DEFAULT_SOURCES).
//
// All three live in state.settings once she has touched them, and all three fall back
// to the defaults here — so a phone that has never edited them behaves exactly as before.
// ⚠️ **A NEW LIST IS DEVICE-LOCAL UNTIL IT IS NAMED IN `sync.js`** — the settings row
// carries a whitelist of keys, so `sources` had to be added to `recordPayload`, to
// `GUARDED` and to `SPEAK_EMPTY` or it would have been silently per-phone (the v200
// lesson, which found five keys device-local by OMISSION rather than by decision).
// The label IS the stored value (rows keep the words they were written with), so a
// method written before this list existed is understood by reading it, not by
// translating it.
// The chart as it ships, written around the categories she named in so many words:
// "salary, EPF, rental, electricity, gas, delivery charges". These labels ARE the
// strings stored on rows, so none of them may be renamed — a row for a deleted
// category is understood by its class, and still printed.
export const DEFAULT_CATEGORIES = [
  { label: "Ingredients & shopping", cls: "stock" },
  { label: "Packaging", cls: "expense" },
  { label: "Rent", cls: "expense" },
  { label: "Utilities", cls: "expense" }, // electricity, gas, water
  { label: "Delivery & fuel", cls: "expense" },
  { label: "Salary (you)", cls: "expense" },
  { label: "EPF / SOCSO", cls: "expense" },
  { label: "Marketing", cls: "expense" },
  { label: "Equipment & tools", cls: "expense" },
  { label: "Other", cls: "expense" },
  { label: "My own withdrawal", cls: "drawing" }, // her money back, never a cost
];

// How money moved. Cash and TNG are what a customer pays with; Loan and Bank OD are
// how SHE pays for things with money that is not in the till yet — the third choice
// she asked for, with room to add her own.
export const DEFAULT_METHODS = ["Cash", "TNG", "Loan"];

// Her categories, or the built-in chart when she has never changed them. Always a
// fresh copy: a caller must never be able to mutate the defaults by accident.
export function categoriesOf(state) {
  const list = state && state.settings && state.settings.categories;
  return Array.isArray(list) && list.length ? list.map((c) => ({ ...c })) : DEFAULT_CATEGORIES.map((c) => ({ ...c }));
}

// Her methods, same rule.
export function methodsOf(state) {
  const list = state && state.settings && state.settings.payMethods;
  return Array.isArray(list) && list.length ? list.map(String) : DEFAULT_METHODS.slice();
}

// ★★ WHERE HER OWN MONEY CAME FROM (v394). Her words, looking at the Put money in form:
// __"should have additional field : from xxx"__ — and, asked whether it should be typed or picked,
// __"Which pot it came from — picked"__.
//
// ⚠️⚠️ THIS IS NOT THE WAYS-TO-PAY LIST, AND THE TWO MUST NOT BE CONFUSED. __Paid in as__ says HOW the
// money went in — Cash, TNG, a loan. __From__ says WHERE it came from: her own pocket, savings, a
// person who lent it to her. **A row can be Cash AND from Savings, and the two questions have
// different answers.**
//
// ⚠️ AND IT REPLACES A HARD-CODED PHRASE. A money-in row has always read __From my pocket__, whatever
// her money actually came from — so this is not a new idea, it is the app finally letting her say which.
// ⚠️ Two pots to start with, because the row must never be bare and the commonest answer is the first
// one; the list is hers to shape, like the other two. See [[project-v394]].
export const DEFAULT_SOURCES = ["My own pocket", "Savings"];

export function sourcesOf(state) {
  const list = state && state.settings && state.settings.sources;
  return Array.isArray(list) && list.length ? list.map(String) : DEFAULT_SOURCES.slice();
}

export function categoryLabels(state) {
  return categoriesOf(state).map((c) => c.label);
}

// What a category means to the accounts. A label that is no longer in the chart —
// an old row whose category she has since deleted — counts as an ordinary expense:
// money went out, and the safe reading is that it counts.
export function classOfCategory(state, label) {
  const found = categoriesOf(state).find((c) => c.label === label);
  if (found) return found.cls;
  const builtIn = DEFAULT_CATEGORIES.find((c) => c.label === label);
  return builtIn ? builtIn.cls : "expense";
}

// The stored words for a method, however they were written. Rows recorded before
// the list existed hold "cash" and "tng" in lower case; the list holds "Cash" and
// "TNG". Reading them the same way is what keeps those rows in the right column.
export function methodLabel(method) {
  const raw = String(method == null ? "" : method).trim();
  if (!raw) return "";
  const key = raw.toLowerCase();
  if (key === "cash") return "Cash";
  if (key === "tng") return "TNG";
  return raw;
}

export const isCash = (method) => methodLabel(method) === "Cash";
export const isTng = (method) => methodLabel(method) === "TNG";

// Everything that is neither cash nor TNG — a loan, a bank overdraft, a cheque.
// Money that paid for something without leaving her purse, which is exactly why the
// Money screen keeps it out of the cash figures.
export const isOther = (method) => {
  const label = methodLabel(method);
  return !!label && !isCash(label) && !isTng(label);
};

// Where a method sits in her list, for reading a row back in the same order the
// form offers. An unknown one sorts last, which is where a row from an old list
// belongs.
// Her ways of paying, split by what they are to the till: the purse and the phone (the
// two that hold her takings), and the pockets — a loan, the bank overdraft, someone's own
// pocket — which pay for things without the money ever going near the till.
export const purseMethods = (state) => methodsOf(state).filter((m) => isCash(m) || isTng(m));
export const pocketMethods = (state) => methodsOf(state).filter((m) => isOther(m));

// The category a drawing is recorded under — her own money going back to her. Taken
// from HER chart rather than hard-coded, since she can rename it.
export function drawingLabel(state) {
  const found = categoriesOf(state).find((c) => c.cls === "drawing");
  return found ? found.label : "My own withdrawal";
}

export function methodRank(state, method) {
  const list = methodsOf(state);
  const at = list.indexOf(methodLabel(method));
  return at < 0 ? list.length : at;
}
