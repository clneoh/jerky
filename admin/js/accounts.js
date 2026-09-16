// accounts.js — the two lists the books are built from (16 Sep 2026), both hers to
// shape:
//
//   • CATEGORIES — what an expense was FOR. Each carries a class, which is what the
//     profit and loss account needs to know: "stock" (ingredients, costed through
//     the recipes), "expense" (a running cost), "drawing" (her money back out).
//   • METHODS — HOW money moved. Cash and TNG are the two a customer uses; Loan and
//     Bank OD are ways of paying for things with money that is not in the till.
//
// Both live in state.settings once she has touched them, and both fall back to the
// defaults here — so a phone that has never edited them behaves exactly as before.
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
