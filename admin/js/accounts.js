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

// ★★ THE TWO ACCOUNTS THAT CANNOT BE DELETED (v487).
//
// Her words: __"lock cash and TNG from deletion"__ — ⭐ and the reason is two lines above: **`isCash`
// and `isTng` are EXACT matches on those two words**, and the tin figure and the phone figure are built
// on them. ⭐ **Delete one and no account is left that a new order can be recorded as cash with** — the
// books go on reading, but nothing new can ever be filed under it again.
//
// ⚠️⚠️ AND SHE HAD ALREADY BEEN BURNT BY IT ONCE, THE SAME DAY: the "Cash" block she asked about three
// times was an account that had left her list. **Renaming stays allowed** — and since v486 a rename
// moves every record with it — so there is nothing a delete is needed for.
export const isLockedAccount = (method) => isCash(method) || isTng(method);

// Where a method sits in her list, for reading a row back in the same order the
// form offers. An unknown one sorts last, which is where a row from an old list
// belongs.
// ★★ EVERY PLACE MONEY SITS IS AN ACCOUNT (v481), AND THERE IS ONE WORD FOR IT NOW.
//
// Her words: __"In finance term we call it account, in our daily, we treat it like a pocket, and a
// pocket means a place money kept. Should we call it account from now on?"__ — ⭐ **yes.**
// `methodsOf(state)` is the list; **every one of them is an account**, every one of them counts in
// the Net (v480), and every one of them gets the same block on the Money screen.
//
// ⚠️⚠️ AND THE LAST SPLIT IS GONE TOO. There used to be two derived lists here — the "purse and
// phone" against the "pockets", and then the accounts a debt could be settled against. ⭐ **Her own
// worked day retired them both.** She measures an account by WHAT IT HOLDS, so an account that holds
// negative is simply down and can be topped up from any other — ⚠️ **and the tin can be down like any
// other, which is why "the tin cannot owe itself" stopped being a fact about anything.**
// See [[project-v481]] and `accountBalance` in money.js.
//
// ⭐ `isCash` / `isTng` / `isOther` stay: they name which block is which and which two she counts by
// hand. They are a LABEL on an account, not a second kind of account.

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

// ★★ MOVING ONE ENTRY TO WHERE SHE DROPPED IT (v477) — the handle's own write, shared by all three
// money lists.
//
// Her words: __"make me a handle, and the handle rule is a universal one."__ ⭐ The rule is the one
// she gave for the shelves: **whatever she repositions with the handle, every drop-down that offers
// those items follows.** ⚠️ So the ORDER IS THE LIST, and this writes it as the list — the reader on
// the other side (`methodsOf`, `categoriesOf`, `sourcesOf`) already hands the array back in its own
// order, which is why no picker needs changing for this to hold.
//
// ⚠️ THE WHOLE LIST IS REWRITTEN, not one index: an entry added or deleted elsewhere must not
// silently shift every other row. The same rule `moveRoute` (deliveryRoutes.js) and `moveInTail`
// (ingredients.js) keep.
//
// ⚠️ AND IT MOVES BY LABEL, because on these lists a LABEL IS THE IDENTITY — the three are arrays
// of `{ label, cls }` and of plain strings, with no id anywhere between them. A rename rewrites the
// rows already recorded under the old name (views/accountsEditor.js), so a label that moves is the
// entry it always was.
export function moveListEntry(list, keyOf, key, toIndex) {
  const rows = Array.isArray(list) ? list : [];
  const at = rows.findIndex((x) => keyOf(x) === key);
  if (at < 0) return rows;
  const rest = rows.filter((_, i) => i !== at);
  const to = Math.max(0, Math.min(Number(toIndex) || 0, rest.length));
  return [...rest.slice(0, to), rows[at], ...rest.slice(to)];
}
