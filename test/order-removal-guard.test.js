// test/order-removal-guard.test.js — nothing may ever remove an order COMPLETELY (v444).
//
// WHY THIS FILE EXISTS, in her words: __"What my concern is it dont happen again"__ — asked after three
// PAID orders left her data on 11 Oct 2026 and were in **none** of her eleven saved copies.
//
// ⚠️⚠️ THE PART THAT MADE IT PERMANENT WAS NOT THE REMOVAL, IT WAS WHAT FOLLOWED. `sync.js` tombstones
// **every record that was in the last snapshot and is gone now** — whatever removed it: a press, a fault,
// a hand-edit. The tombstone goes to the shared cloud, the other phone deletes its copy, and every backup
// taken afterwards is a copy of data the order is already missing from. ⭐ A loss with no way back, on any
// device, for ever.
//
// ⭐ SO THIS FILE PINS TWO THINGS:
//   1. **ONE DOOR OUT.** Every removal goes through `state.js:removeOrders`, which KEEPS the row on a shelf
//      she can put back from. No screen may reassign `state.orders` for itself.
//   2. **THE CLOUD'S REMOVAL LANDS ON THE SHELF TOO** — a tombstone from the other phone is a removal
//      nobody here made, and it is the one that propagated her loss.
//
// ⚠️ IT DOES NOT CLAIM TO HAVE FOUND THE CAUSE. It cannot: the removal left no trace, which is the fault.
// **It makes the next one recoverable whatever the cause** — and that is the only honest promise available.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { defaultState, loadState, normalize, removeOrders, restoreRemovedOrder, dropStaleShelfRows, REMOVED_KEEP_HOURS } from "../admin/js/state.js";

const JS_DIR = new URL("../admin/js/", import.meta.url).pathname;

function allSources(dir = JS_DIR, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) allSources(p, out);
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

test("★★ no file may drop rows from state.orders except the one door (v444)", () => {
  // ⚠️ THE GUARD IS A GREP ON PURPOSE. A behaviour test can only cover the removals that exist today —
  // this covers the one somebody adds next year, which is how the fault got in. ⭐ Everything else in the
  // app may still build, map and normalise a list of orders (`normalize` and the two id-repair passes in
  // state.js all do); what is forbidden is REASSIGNING the live list anywhere but the door.
  const offenders = allSources()
    .filter((f) => !f.endsWith("/state.js") && /state\.orders\s*=/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(f.indexOf("/admin/js/") + 1));
  assert.deepEqual(offenders, [],
    `★ a file drops rows from state.orders outside the one door: ${offenders.join(", ")}`);

  // ⚠️ AND THE DOOR MUST STILL BE A DOOR. If `removeOrders` were deleted, the grep above would pass
  // over an app with no guard at all — the `[].every()` trap this project has written down more than
  // once. So the two files that DO remove orders are required to use it.
  assert.match(readFileSync(join(JS_DIR, "state.js"), "utf8"), /export function removeOrders/,
    "the one door is gone, so nothing else here proves anything");
  for (const rel of ["views/orders.js", "sync.js"]) {
    assert.match(readFileSync(join(JS_DIR, rel), "utf8"), /removeOrders\(/,
      `★ ${rel} removes orders without going through the one door`);
  }
});

// ★★★ ONE ORDER, ONE SHELF ROW — ALWAYS (v528).
//
// ⚠️⚠️ HER REPORT: __"there is so many duplicate order number in the Removed Orders"__. ⭐ **The shelf simply
// unshifted a new row every time, so an order that came back and was taken off again left a SECOND row with
// the same number** — and ⭐⭐ **the shared data hands an order back whenever its removal has not landed, so
// that is a LOOP, not an accident: the queue grows and the shelf fills with the same number.**
test("★★★ taking the same order off twice leaves ONE row on the shelf", () => {
  const row = () => ({ id: "o1", deliveryDateId: "d1", productId: "p1", qty: 20, customerName: "Jien" });
  const st = { orders: [row()], deliveryDates: [], removedOrders: [] };

  removeOrders(st, ["o1"]);
  assert.equal(st.removedOrders.length, 1, "precondition: the first removal did not reach the shelf");

  // ⚠️ THE LOOP, EXACTLY AS IT HAPPENS: the shared data hands the order BACK, because the removal of it
  // never left this phone — and she takes it off again.
  st.orders = [row()];
  removeOrders(st, ["o1"]);

  assert.equal(st.removedOrders.length, 1,
    "★ the same order is on the shelf TWICE — **one order, one row, or her Removed list fills with the same "
    + "order number over and over, which is what she is looking at**");
  assert.equal(st.removedOrders[0].id, "o1", "the row kept is not the order that came off");
});

test("★★★ and the duplicates her phones already hold are collapsed when the app opens", () => {
  // ⚠️⚠️ **WITHOUT THIS THE FIX ABOVE WOULD FIX NOTHING FOR HER** — the duplicate rows are already sitting in
  // her data, on both phones. ⭐ The same reason the v518 void repair had to exist for the button fix to be
  // worth anything: ⭐ **a fix to the door does not tidy the room behind it.**
  // ⚠️ A REAL `localStorage`, because the repair lives on the LOAD path and nothing else reaches it — the
  // same reason the v518 void-repair test had to go through `loadState`.
  const store = new Map();
  const real = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  let st;
  try {
    store.set("bakeadmin.v1", JSON.stringify({
      version: 1,
      orders: [],
      removedOrders: [
        { id: "o1", qty: 1, removedAt: "2026-10-17T02:00:00.000Z" },
        { id: "o2", qty: 2, removedAt: "2026-10-16T09:00:00.000Z" },
        { id: "o1", qty: 1, removedAt: "2026-10-11T10:47:00.000Z" },
      ],
    }));
    st = loadState();
  } finally {
    if (real === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = real;
  }

  assert.deepEqual(st.removedOrders.map((r) => r.id), ["o1", "o2"],
    "★ the duplicate shelf rows survived a load — **so her Removed list keeps showing the same order number**");
  // ⚠️ AND THE ROW KEPT IS THE NEWEST: `removedAt` is what the 48 hours are counted from, so keeping the
  // older one would silently shorten the window a removed order can be put back in.
  assert.equal(st.removedOrders[0].removedAt, "2026-10-17T02:00:00.000Z",
    "★ the OLDER row was kept, so the 48 hours run from the wrong moment");
});

test("★ a removed order is KEPT, not destroyed — and put back exactly as it was", () => {
  const st = { orders: [
      { id: "o1", deliveryDateId: "d1", productId: "p1", qty: 20, customerName: "Jien", groupId: "g1" },
      { id: "o2", deliveryDateId: "d1", productId: "p1", qty: 3, customerName: "Mei Ling" },
    ], deliveryDates: [], removedOrders: [] };
  const before = JSON.parse(JSON.stringify(st.orders[0]));

  const gone = removeOrders(st, ["o1"], "an edit");
  assert.equal(gone.length, 1, "the door removed nothing, so nothing about it is being tested");
  assert.deepEqual(st.orders.map((o) => o.id), ["o2"], "the wrong order left the live list");
  assert.equal(st.removedOrders.length, 1, "★ the removed order was destroyed instead of kept");
  assert.equal(st.removedOrders[0].id, "o1");
  assert.ok(st.removedOrders[0].removedAt, "the shelf does not say when it was taken off");

  // ⭐ PUT IT BACK — the same id, day, group and quantity, and no loss-mark left on it.
  const back = restoreRemovedOrder(st, "o1");
  assert.ok(back, "the row on the shelf could not be put back");
  assert.equal(st.removedOrders.length, 0, "the shelf kept a row it had already restored");
  assert.deepEqual(st.orders.find((o) => o.id === "o1"), before,
    "★ the order came back different from the one that left");
  // ⚠️ AND NOTHING ELSE MOVED.
  assert.deepEqual(st.orders.map((o) => o.id).sort(), ["o1", "o2"]);
});

test("★★ an order deleted on the OTHER phone lands on this phone's shelf (v444)", async () => {
  // ⚠️⚠️ THIS IS THE PATH THAT COST HER THE ORDERS. A tombstone is a removal nobody here made, it takes
  // the whole order away in one line of the merge, and it propagates back to everything.
  const { mergeRows } = await import("../admin/js/sync.js");
  const st = {
    orders: [{ id: "o1", deliveryDateId: "d1", productId: "p1", qty: 20, customerName: "Jien" }],
    deliveryDates: [], removedOrders: [],
  };
  mergeRows(st, [{ kind: "orders", id: "o1", data: null, _deleted: true,
    updated_at: new Date(Date.now() + 60000).toISOString() }]);

  assert.equal(st.orders.some((o) => o.id === "o1"), false,
    "the tombstoned order is still in the live list, so the fixture proves nothing");
  assert.equal(st.removedOrders.length, 1,
    "★ an order deleted on the other phone was destroyed here rather than kept");
  assert.equal(st.removedOrders[0].id, "o1");
  // ⚠️⚠️ AND THE LABEL NAMES THE PATH, NOT A CULPRIT (v455). It used to say "removed on another phone" —
  // **and her other phone had deleted nothing.** A tombstone can also be THIS phone's own removal coming
  // back on the next sync, so the shelf was asserting a cause the app cannot know. ⭐ The same rule the
  // whole of this week kept teaching: say what was observed, never who is to blame.
  assert.match(String(st.removedOrders[0].removedWhy || ""), /shared data/,
    "★ the shelf does not say the removal arrived through the shared data");
  assert.doesNotMatch(String(st.removedOrders[0].removedWhy || ""), /another phone/,
    "★ the shelf is naming a culprit again — it cannot know which phone removed it");
});

test("★ the shelf is pruned, so keeping things cannot leak", () => {
  // ⚠️⚠️ AND HER NUMBER IS PINNED, not merely read. Her words at v452: __"the deleted order just need to
  // keep for 48hrs"__ — and a test that only compares against the constant would pass with ANY value in
  // it, including the thirty days the developer had guessed before she corrected him. ⭐ **A duration is a
  // decision, so the test states the decision.**
  // ⭐⭐ AND SHE RAISED IT HERSELF ON 17 OCTOBER 2026: __"raise it and fix it"__ — thirty days, because the
  // check opens the OLDEST DAILY copy (about a week back) and a two-day shelf could not explain a removal
  // inside it, so it named seven of her own cancellations. ⚠️ **The pinned number moves WITH her decision;
  // it is never quietly read off the constant.**
  assert.equal(REMOVED_KEEP_HOURS, 720, `★ the shelf keeps orders for ${REMOVED_KEEP_HOURS} hours, not her 30 days`);
  const st = { orders: [], removedOrders: [] };
  const old = new Date(Date.now() - (REMOVED_KEEP_HOURS + 5) * 3600000).toISOString();
  st.removedOrders = [{ id: "ancient", removedAt: old }, { id: "today", removedAt: new Date().toISOString() }];
  st.orders = [{ id: "o1" }, { id: "o2" }];
  removeOrders(st, ["o1"]);
  assert.equal(st.removedOrders.some((r) => r.id === "ancient"), false,
    "★ a row older than the keeping period was left on the shelf");
  assert.equal(st.removedOrders.some((r) => r.id === "today"), true, "a fresh row was pruned away");
});

test("⚠️ a phone that has never removed an order, and a state written before v444, both behave as before", () => {
  // ⚠️ Guarded like every other list she owns — an older state has no `removedOrders` key at all, and the
  // door has to work on it without throwing.
  const old = normalize({ version: 1, orders: [{ id: "o1" }], deliveryDates: [] });
  assert.deepEqual(old.removedOrders, [], "an older state did not come back with an empty shelf");
  // ⚠️ `normalize` stamps a status on an order that had none, so the row that goes to the shelf is the
  // NORMALISED one — asserted by id rather than by a whole object, which would be asserting `normalize`'s
  // business from the wrong file.
  assert.deepEqual(removeOrders(old, ["o1"]).map((o) => o.id), ["o1"]);
  assert.deepEqual(old.removedOrders.map((r) => r.id), ["o1"]);
  // ⚠️ And a call that names nothing removes nothing, rather than emptying the list.
  assert.deepEqual(removeOrders(old, []), []);
  assert.deepEqual(removeOrders(old, [undefined, null]), []);
  assert.equal(old.orders.length, 0);
  assert.equal(defaultState().removedOrders.length, 0, "a brand-new state does not start with an empty shelf");
});

// ── v474: a shelf row for an order that is BACK is dropped ───────────────────
test("★★★ a shelf row for an order that is back in the live list is DROPPED — the invariant", () => {
  // ⚠️⚠️ HER REPORT, with the check's own line: __"Nothing is on the orders list and the Removed list at
  // once — 3"__, naming the three she put back after the 11 October loss. ⭐ **Their shelf rows survived the
  // restore because SENDING WAS BROKEN when she did it** — the row's removal was queued and never left, so
  // it came back down on the next pull. ⚠️ **The same damage as every other line that week.**
  // ⭐ **AND IT IS NOT SOMETHING SHE SHOULD HAVE TO CLEAR BY HAND: an order cannot be in the live list and
  // on the shelf at once.** The shelf holds what is NOT live — so such a row is stale, **and dropping it
  // cannot lose anything, because the order itself is right there.**
  const st = {
    orders: [{ id: "o1", deliveryDateId: "d1", productId: "p1", qty: 20, customerName: "Jien" }],
    deliveryDates: [],
    removedOrders: [{ id: "o1", removedAt: new Date().toISOString() }],   // the stale row
  };
  const dropped = dropStaleShelfRows(st);
  assert.equal(dropped, 1, "★ the stale shelf row was left where it was");
  assert.equal(st.removedOrders.length, 0, "the shelf still holds a row for an order that is back");
  assert.equal(st.orders.length, 1, "⚠️ and the ORDER must not have been touched — only the stale row");
});

test("★★⚠️ and a row for a GENUINELY removed order is KEPT — the fix must not empty the shelf", () => {
  // ⚠️⚠️ THE HALF THAT MATTERS MOST. ⭐ **The shelf is the only place a removed order survives** (v444) —
  // so a fix that emptied it would destroy the recovery it exists for. **This is the assertion that says
  // the tidy only ever drops what is already live.**
  const st = {
    orders: [{ id: "o1", deliveryDateId: "d1", productId: "p1", qty: 20, customerName: "Jien" }],
    deliveryDates: [],
    removedOrders: [{ id: "o2", removedAt: new Date().toISOString(), removedWhy: "an edit" }],
  };
  assert.equal(dropStaleShelfRows(st), 0, "★ a genuinely removed order was tidied away");
  assert.deepEqual(st.removedOrders.map((r) => r.id), ["o2"],
    "★ the shelf lost a row for an order that is NOT in the live list — that is the recovery gone");
});

test("★ and the invariant holds on LOAD as well as on a merge", () => {
  // ⚠️ `normalize` carries it too, so a phone that is opened with a stale row already in its storage is
  // tidy the moment it loads — not only after a sync.
  const old = normalize({
    version: 1,
    orders: [{ id: "o1", deliveryDateId: "d1", productId: "p1", qty: 1 }],
    deliveryDates: [],
    removedOrders: [{ id: "o1", removedAt: new Date().toISOString() }, { id: "o9", removedAt: new Date().toISOString() }],
  });
  assert.deepEqual(old.removedOrders.map((r) => r.id), ["o9"],
    "★ loading a state with a stale shelf row left it in place");
});
