// test/parcel-couriers.test.js — the Parcel couriers screen (v226).
//
// The second KIND of courier is a list she owns, and this screen is the only place
// it is edited. Rendered under a tiny DOM shim (mirrors ingredients-editor.test.js)
// and driven through its own buttons, because the claims that matter here are about
// what the screen DOES: a blank or duplicate name is refused, the one-press import
// adds only what is missing, and — the whole point of the design — deleting a
// carrier that orders already name is allowed, because each order froze the name.

import { test } from "node:test";
import assert from "node:assert/strict";

// --- DOM shim (mirrors test/ingredients-editor.test.js) ---
function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    scrollTop: 0, hidden: false, _listeners: {},
    classList: {
      add() {}, remove() {}, toggle() {},
      contains() { return false; },
    },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    // Faithful on purpose (the same rule test/board-view.test.js:106 carries): the real
    // `append` and `replaceChildren` do NOT skip a null the way `el()` skips a null
    // child — they convert every argument with String(), so a bare `?: null` puts the
    // literal word "null" on the screen. A shim that quietly dropped it would have
    // hidden exactly that on this screen: handing `replaceChildren` a null when she
    // already had every usual carrier printed "null" under the add card, and this shim
    // said the screen was clean.
    append(...cs) {
      for (const c of cs) this.appendChild(c && c.nodeType ? c : doc.createTextNode(String(c)));
    },
    replaceChildren(...cs) {
      this.children = [];
      for (const c of cs) this.appendChild(c && c.nodeType ? c : doc.createTextNode(String(c)));
    },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    focus() {}, click() {},
    querySelector(sel) {
      const wantId = sel.startsWith("#");
      const walk = (n) => {
        for (const c of n.children || []) {
          if (c.nodeType !== 1) continue;
          if (wantId ? (c.attrs && c.attrs.id === sel.slice(1)) : c.tagName === sel.toUpperCase()) return c;
          const hit = walk(c);
          if (hit) return hit;
        }
        return null;
      };
      return walk(this);
    },
  };
}
const registry = {};
const doc = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: createEl("body"),
};
globalThis.document = doc;
globalThis.setTimeout = (fn) => { fn(); return 1; };
globalThis.clearTimeout = () => {};
// A fresh id per call: two carriers added by hand in one test must be two rows,
// and an id that repeated would let Delete take both. Node's own crypto is only a
// getter on globalThis, so it is redefined rather than assigned.
let uuidSeq = 0;
Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  // The counter goes at the FRONT: newId strips the dashes and keeps the first 12
  // characters, so a counter at the tail would be sliced off and every carrier
  // would come out with the same id.
  value: { randomUUID: () => `${String(++uuidSeq).padStart(12, "0")}-0000-4000-8000-000000000000` },
});
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

import { renderParcelCouriers } from "../admin/js/views/parcelCouriers.js";
import { USUAL_CARRIERS } from "../admin/js/parcel.js";

function freshState() {
  return {
    settings: { currency: "RM", supabase: {} },
    parcelCouriers: [],
    orders: [],
    products: [],
  };
}

function walk(root, out = []) {
  for (const c of root.children || []) { out.push(c); walk(c, out); }
  return out;
}
function textOf(n) {
  if (!n) return "";
  if (n.nodeType === 3) return n.text ?? "";
  if (n.textContent) return n.textContent;
  return (n.children || []).map(textOf).join("");
}
const fire = (node) => (node._listeners.click || []).forEach((f) => f());
// What the confirmation ASKS, read off the message alone — walking the whole layer
// would sweep in the Cancel and Delete buttons' own words.
const confirmText = (layer) => textOf(walk(layer).find((n) => String(n.className).includes("confirm-text")));
const change = (node) => (node._listeners.change || []).forEach((f) => f({ target: node }));
const screenText = (root) => textOf(root);

function render(state) {
  const root = doc.createElement("div");
  renderParcelCouriers(root, state);
  return root;
}

// The always-on New carrier card is root.children[0].
function formHandles(root) {
  const nodes = walk(root.children[0]);
  const byPlaceholder = (ph) => nodes.find((n) => n.tagName === "INPUT" && n.attrs.placeholder === ph);
  return {
    name: nodes.find((n) => n.tagName === "INPUT" && (n.attrs.placeholder || "").startsWith("e.g. J&T")),
    note: byPlaceholder("Optional — e.g. counter at Prangin Mall"),
    add: nodes.find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Add carrier"),
  };
}
function press(text, root) {
  const b = walk(root).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === text);
  assert.ok(b, `a "${text}" press is on the screen`);
  fire(b);
  return b;
}
// The carrier's OWN row card — matched on its card-title, not on its text, because
// the import card also lists every usual carrier's name in a sentence.
function cardFor(name, root) {
  return walk(root).find((n) => n.nodeType === 1 && String(n.className).includes("card")
    && walk(n).some((c) => String(c.className).includes("card-title") && textOf(c).trim() === name));
}
// The last toast raised, read off the body the shim appends to.
function lastToast() {
  const t = (doc.body.children || []).filter((n) => n.nodeType === 1 && String(n.className).includes("toast"));
  return t.length ? textOf(t[t.length - 1]) : "";
}

// ── the fresh phone ────────────────────────────────────────────────────────

test("a fresh screen offers both doors and says it has no carriers yet", () => {
  const state = freshState();
  const root = render(state);

  assert.ok(formHandles(root).name, "the New carrier card is always there");
  assert.ok(screenText(root).includes("Parcel couriers (0)"), "and the count says so");
  assert.ok(screenText(root).includes("No carriers yet"), "with an explanation of what a carrier is for");
  assert.ok(screenText(root).includes("the customer is shown the consignment number"),
    "and why she would add one");
});

// ── adding by hand ─────────────────────────────────────────────────────────

test("a carrier typed by hand saves, and the screen redraws around it", () => {
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);

  f.name.value = "J&T Express";
  f.note.value = "counter at Prangin Mall";
  press("Add carrier", root);

  assert.equal(state.parcelCouriers.length, 1);
  const saved = state.parcelCouriers[0];
  assert.match(saved.id, /^pc_/, "an id in the app's own carrier prefix, so the cloud rows never collide");
  assert.equal(saved.name, "J&T Express");
  assert.equal(saved.note, "counter at Prangin Mall");
  assert.ok(screenText(root).includes("Parcel couriers (1)"), "the count follows");
  assert.ok(cardFor("J&T Express", root), "and the carrier has a row of its own");
});

test("a carrier with no note saves cleanly", () => {
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  f.name.value = "Ninja Van";
  press("Add carrier", root);

  assert.equal(state.parcelCouriers[0].name, "Ninja Van");
  assert.equal(state.parcelCouriers[0].note, undefined, "no note typed → no note stored");
});

test("a blank name is refused in words and adds nothing", () => {
  const state = freshState();
  const root = render(state);
  const f = formHandles(root);
  f.name.value = "   ";
  press("Add carrier", root);

  assert.equal(state.parcelCouriers.length, 0, "nothing saved");
  assert.equal(lastToast(), "Carrier needs a name", "and she is told why");
});

test("the same carrier cannot be added twice, whatever the spacing", () => {
  const state = freshState();
  state.parcelCouriers.push({ id: "pc_jt", name: "J&T Express" });
  const root = render(state);
  const f = formHandles(root);
  f.name.value = "  j&t express  ";
  press("Add carrier", root);

  assert.equal(state.parcelCouriers.length, 1, "a second copy is refused");
  assert.equal(lastToast(), 'A carrier called "j&t express" already exists');
});

test("two carriers added by hand are two rows, each with its own Edit and Delete", () => {
  const state = freshState();
  const root = render(state);
  for (const n of ["J&T Express", "Ninja Van"]) {
    formHandles(root).name.value = n;
    press("Add carrier", root);
  }
  assert.equal(state.parcelCouriers.length, 2);
  assert.notEqual(state.parcelCouriers[0].id, state.parcelCouriers[1].id, "distinct ids");
  for (const c of state.parcelCouriers) {
    const card = cardFor(c.name, root);
    assert.ok(card, `${c.name} has a row`);
    for (const label of ["Edit", "Delete"]) {
      assert.ok(walk(card).some((n) => n.tagName === "BUTTON" && textOf(n).trim() === label),
        `and a ${label} press`);
    }
  }
});

// ── the one-press import ───────────────────────────────────────────────────

test("the usual carriers arrive in one press, only the ones she lacks", () => {
  const state = freshState();
  state.parcelCouriers.push({ id: "pc_jt", name: "J&T (Prangin counter)" });
  const root = render(state);

  assert.ok(screenText(root).includes("The usual carriers"), "the import is offered");
  press(`Add ${USUAL_CARRIERS.length - 1} carriers`, root);

  assert.equal(state.parcelCouriers.length, USUAL_CARRIERS.length,
    "the one she already had is not duplicated under its old name");
  assert.equal(state.parcelCouriers.find((c) => c.id === "pc_jt").name, "J&T (Prangin counter)",
    "her own name for it is left exactly as she typed it");
});

test("once every usual carrier is on hand the import disappears rather than doing nothing", () => {
  const state = freshState();
  const root = render(state);
  press(`Add ${USUAL_CARRIERS.length} carriers`, root);

  assert.equal(state.parcelCouriers.length, USUAL_CARRIERS.length);
  assert.ok(!screenText(root).includes("The usual carriers"),
    "a press that could add nothing is not left on the screen looking live");
  assert.ok(screenText(root).includes(`Parcel couriers (${USUAL_CARRIERS.length})`));
});

// A screen must never print the word "null". The usual-carriers card is drawn only while
// there is something to add, so the branch that draws it ends in a null the moment she has
// them all — and `replaceChildren` is a DOM method, not `el()`: it has no null filter, it
// converts every argument with String(), and a null left in the list reaches the screen as
// the literal word. This was live at 375px in v226, under the add card, on exactly the
// state the second case below builds.
test("nothing on the screen ever reads null, in any of the three shapes it can take", () => {
  const onScreen = (root) => walk(root)
    .filter((n) => n.nodeType === 3)
    .map((n) => String(n.text).trim());
  const empty = render(freshState());                     // no carriers yet, the import offered
  const holding = render((() => {                          // one usual carrier already on hand
    const s = freshState();
    s.parcelCouriers.push({ id: "pc_jt", name: "J&T Express" });
    return s;
  })());
  const full = freshState();                               // every usual carrier on hand
  const root = render(full);
  press(`Add ${USUAL_CARRIERS.length} carriers`, root);

  for (const [what, r] of [["empty", empty], ["partly stocked", holding], ["fully stocked", root]]) {
    assert.equal(onScreen(r).includes("null"), false,
      `the ${what} screen prints no stray null — the import card is absent there, not null`);
    assert.equal(onScreen(r).includes("undefined"), false, `and no stray undefined (${what})`);
  }
  assert.ok(!screenText(root).includes("The usual carriers"), "the absent card really is absent");
});

test("the import carries fixed ids, so her second phone lands on the same rows", () => {
  const state = freshState();
  const root = render(state);
  press(`Add ${USUAL_CARRIERS.length} carriers`, root);

  assert.deepEqual(state.parcelCouriers.map((c) => c.id), USUAL_CARRIERS.map((c) => c.id));
});

// ── editing ────────────────────────────────────────────────────────────────

test("renaming a carrier updates the row, and says orders already recorded are untouched", () => {
  const state = freshState();
  state.parcelCouriers.push({ id: "pc_jt", name: "J&T Express" });
  const root = render(state);

  fire(walk(cardFor("J&T Express", root)).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Edit"));
  const layer = registry["popup-layer"];
  assert.ok(textOf(layer).includes("Edit carrier"), "the pop-up opens over the screen");
  assert.ok(textOf(layer).includes("does not change an order you have already recorded"),
    "and warns her before she renames — the frozen name is the promise");

  const nameBox = walk(layer).find((n) => n.tagName === "INPUT" && (n.attrs.placeholder || "").startsWith("e.g. J&T"));
  nameBox.value = "J&T (Prangin counter)";
  press("Update carrier", layer);

  assert.equal(state.parcelCouriers[0].name, "J&T (Prangin counter)");
  assert.ok(cardFor("J&T (Prangin counter)", root), "the screen redraws with the new name");
});

test("the edit pop-up refuses to empty a carrier's name", () => {
  const state = freshState();
  state.parcelCouriers.push({ id: "pc_jt", name: "J&T Express" });
  const root = render(state);

  fire(walk(cardFor("J&T Express", root)).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Edit"));
  const layer = registry["popup-layer"];
  walk(layer).find((n) => n.tagName === "INPUT" && (n.attrs.placeholder || "").startsWith("e.g. J&T")).value = "";
  press("Update carrier", layer);

  assert.equal(state.parcelCouriers[0].name, "J&T Express", "the carrier keeps its name");
  assert.equal(lastToast(), "Carrier needs a name");
});

// ── deleting: allowed, and safe ────────────────────────────────────────────

test("deleting a carrier no order names asks plainly, and then removes it", () => {
  const state = freshState();
  state.parcelCouriers.push({ id: "pc_jt", name: "J&T Express" });
  const root = render(state);

  fire(walk(cardFor("J&T Express", root)).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Delete"));
  const layer = registry["confirm-layer"];
  assert.equal(confirmText(layer), 'Delete carrier "J&T Express"?', "no threat where there is nothing to lose");

  fire(walk(layer).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Delete"));
  assert.equal(state.parcelCouriers.length, 0);
  assert.ok(!cardFor("J&T Express", root), "and the row is gone");
});

test("deleting a carrier that orders DO name is allowed, and the warning tells the truth", () => {
  const state = freshState();
  state.parcelCouriers.push({ id: "pc_jt", name: "J&T Express" });
  // Two orders that recorded this carrier. Each froze the name onto itself, which
  // is why this delete is safe — so the screen must not imply that history breaks.
  state.orders.push(
    { id: "ord_1", parcel: { carrierId: "pc_jt", carrierName: "J&T Express", handedAt: "" } },
    { id: "ord_2", parcel: { carrierId: "pc_jt", carrierName: "J&T Express", handedAt: "" } },
  );
  const root = render(state);

  const card = cardFor("J&T Express", root);
  assert.ok(textOf(card).includes("2 orders recorded"), "the row says how many orders it is on");

  fire(walk(card).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Delete"));
  const layer = registry["confirm-layer"];
  const words = confirmText(layer);
  assert.ok(words.includes("2 orders have"), "the confirmation counts them");
  assert.ok(words.includes("keep the name"), "and says they keep the name");
  assert.ok(words.includes("keep showing it to the customer"), "and that the customer still sees it");

  fire(walk(layer).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Delete"));
  assert.equal(state.parcelCouriers.length, 0, "the delete really happens");
  assert.equal(state.orders[0].parcel.carrierName, "J&T Express",
    "and the order is untouched — the frozen name is what makes this safe");
});

test("a carrier it deleted comes back on offer in the import, and only there", () => {
  const state = freshState();
  const root = render(state);
  press(`Add ${USUAL_CARRIERS.length} carriers`, root);
  assert.ok(!screenText(root).includes("The usual carriers"));

  fire(walk(cardFor("Ninja Van", root)).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Delete"));
  const layer = registry["confirm-layer"];
  fire(walk(layer).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Delete"));

  assert.ok(screenText(root).includes("The usual carriers"), "already-existing ones do not resurrect");
  press("Add 1 carrier", root);
  assert.equal(state.parcelCouriers.length, USUAL_CARRIERS.length);
  assert.ok(state.parcelCouriers.some((c) => c.id === "pc_ninja"), "the one she deleted");
});

test("cancelling a delete changes nothing at all", () => {
  const state = freshState();
  state.parcelCouriers.push({ id: "pc_jt", name: "J&T Express" });
  const root = render(state);

  fire(walk(cardFor("J&T Express", root)).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Delete"));
  const layer = registry["confirm-layer"];
  fire(walk(layer).find((n) => n.tagName === "BUTTON" && textOf(n).trim() === "Cancel"));

  assert.equal(state.parcelCouriers.length, 1);
  assert.ok(cardFor("J&T Express", root));
});

// ── the design claim: this screen names no price and books nothing ─────────
// A parcel carrier is a RECORD. The moment this screen grows a rate or a Book
// press it has become a half-built provider, and a rate would quietly lie — a
// parcel's price moves with the zone and the box, and the volumetric divisor
// differs per carrier. So: no money, no quote, no book, and no courier named.

test("the screen shows no price, no quote and no booking, because it books nothing", () => {
  const state = freshState();
  const root = render(state);
  press(`Add ${USUAL_CARRIERS.length} carriers`, root);

  const words = screenText(root);
  for (const forbidden of ["RM", "Quote", "Book", "Estimated", "Lalamove"]) {
    assert.equal(words.includes(forbidden), false, `no "${forbidden}" anywhere on the carriers screen`);
  }
});
